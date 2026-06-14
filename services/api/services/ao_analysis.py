"""Service d'analyse d'appels d'offres BTP pour les marchés DOM.

Encapsule l'appel LLM via ``agents.llm.complete_json`` afin de produire une
analyse structurée et riche d'un appel d'offres BTP (titulaires DOM). Le
résultat est un dict JSON directement persisté comme ``content`` d'un
Document de type ``analyse_ao``.

En cas d'indisponibilité du LLM (``LLMUnavailable``) ou d'une erreur quelconque,
la fonction retourne un stub cohérent renseigné avec les données brutes reçues,
de sorte que l'application reste toujours fonctionnelle.
"""

from __future__ import annotations

import logging

from agents.llm import LLMUnavailable, complete_json

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt système
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "Tu es un responsable d'appels d'offres BTP experimente, specialise dans les "
    "marches publics des Departements et Regions d'Outre-Mer (DOM : Martinique, "
    "Guadeloupe, Guyane, La Reunion, Mayotte, Saint-Martin). "
    "Tu analyses un appel d'offres a partir du titre, du resume et des lots "
    "fournis. Regles strictes :\n"
    "- N'invente JAMAIS d'informations : si une donnee est absente, "
    "indique 'Non precise' ou laisse la liste vide.\n"
    "- Identifie les specificites des DOM (logistique insulaire, "
    "reglementation locale, risques sismiques/cycloniques, "
    "delais d'acheminement des materiaux).\n"
    "- Extrais les lots, les pieces a remettre, les criteres de selection "
    "et leur ponderation si elle est connue, les delais cles, les "
    "contraintes propres aux DOM et les risques.\n"
    "- Formule une recommandation claire : Repondre / Ne pas repondre / "
    "A approfondir.\n"
    "- Reste factuel et sobre : pas de marketing.\n"
    "Reponds UNIQUEMENT par un objet JSON valide, sans texte autour, "
    "de la forme :\n"
    '{"synthese": "<resume de l\'AO en 2-3 phrases>", '
    '"lots": [{"numero": "<n>", "intitule": "<intitule>", "montant_estime": "<montant ou null>"}], '
    '"pieces_demandees": ["<piece>", ...], '
    '"criteres": [{"libelle": "<critere>", "ponderation": "<% ou null>"}], '
    '"delais": "<synthese des delais cles>", '
    '"contraintes_dom": ["<contrainte specifique DOM>", ...], '
    '"risques": ["<risque identifie>", ...], '
    '"recommandation": "<Repondre|Ne pas repondre|A approfondir> — <justification courte>"}'
)

# ---------------------------------------------------------------------------
# Helpers internes
# ---------------------------------------------------------------------------


def _str_list(value: object) -> list[str]:
    """Coerce an arbitrary value into a clean list of strings."""
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _lot_list(value: object) -> list[dict]:
    """Normalise the lots field into a list of dicts with expected keys."""
    if not isinstance(value, list):
        return []
    result: list[dict] = []
    for item in value:
        if isinstance(item, dict):
            result.append(
                {
                    "numero": str(item.get("numero", "")).strip(),
                    "intitule": str(item.get("intitule", "")).strip(),
                    "montant_estime": item.get("montant_estime") or None,
                }
            )
        elif isinstance(item, str) and item.strip():
            result.append({"numero": "", "intitule": item.strip(), "montant_estime": None})
    return result


def _critere_list(value: object) -> list[dict]:
    """Normalise the criteres field into a list of dicts with expected keys."""
    if not isinstance(value, list):
        return []
    result: list[dict] = []
    for item in value:
        if isinstance(item, dict):
            result.append(
                {
                    "libelle": str(item.get("libelle", "")).strip(),
                    "ponderation": item.get("ponderation") or None,
                }
            )
        elif isinstance(item, str) and item.strip():
            result.append({"libelle": item.strip(), "ponderation": None})
    return result


def _stub_content(
    title: str,
    summary: str | None,
    lots: object,
    reason: str,
) -> dict:
    """Return a coherent stub content dict when the LLM is unavailable."""
    lots_list: list[dict] = []
    if isinstance(lots, list):
        lots_list = _lot_list(lots)

    return {
        "stub": True,
        "synthese": (
            f"Analyse indisponible (LLM non configure ou erreur). "
            f"Titre : {title}. "
            f"Resume : {summary or 'Non fourni'}."
        ),
        "lots": lots_list,
        "pieces_demandees": [],
        "criteres": [],
        "delais": "Non precise",
        "contraintes_dom": [],
        "risques": [
            f"LLM indisponible : {reason}. "
            "Analyse a realiser manuellement avant toute reponse."
        ],
        "recommandation": "A approfondir — LLM indisponible, analyse manuelle requise.",
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def analyze_offer(
    *,
    title: str,
    summary: str | None,
    lots: object,
    url: str | None,
    instruction: str | None,
    provider: str | None,
    model: str | None,
    skills_text: str = "",
) -> dict:
    """Analyse un appel d'offres BTP et retourne un dict de contenu structuré.

    Paramètres
    ----------
    title:
        Titre de l'offre telle qu'elle figure dans ``TenderOffer.title``.
    summary:
        Résumé ou description de l'offre (``TenderOffer.summary``), peut être None.
    lots:
        Valeur brute du champ ``TenderOffer.lots`` (JSON/list ou None).
    url:
        URL source de l'offre, ajoutée au prompt pour contexte.
    instruction:
        Instruction libre de l'utilisateur (``TenderAnalyzeRequest.instruction``).
    provider:
        Nom du fournisseur LLM à utiliser (ex. ``"anthropic"``), ou None pour le défaut.
    model:
        Identifiant du modèle LLM, ou None pour le défaut du provider.
    skills_text:
        Texte de compétences de l'entreprise à injecter en tête du prompt système.

    Retourne
    --------
    dict
        Contenu structuré compatible avec ``Document.content`` (type ``analyse_ao``).
        Les clés garanties sont : ``synthese``, ``lots``, ``pieces_demandees``,
        ``criteres``, ``delais``, ``contraintes_dom``, ``risques``,
        ``recommandation``. En cas d'erreur, ``"stub": True`` est aussi présent.
    """
    system = f"{skills_text}\n\n{_SYSTEM_PROMPT}" if skills_text else _SYSTEM_PROMPT

    # Build the user prompt from available fields.
    lots_text = ""
    if isinstance(lots, list) and lots:
        lots_items = []
        for lot in lots:
            if isinstance(lot, dict):
                num = lot.get("numero", "")
                label = lot.get("intitule", lot.get("label", lot.get("title", "")))
                lots_items.append(f"  - Lot {num}: {label}" if num else f"  - {label}")
            elif isinstance(lot, str):
                lots_items.append(f"  - {lot}")
        if lots_items:
            lots_text = "Lots identifies :\n" + "\n".join(lots_items)

    user_parts = [
        f"Titre de l'appel d'offres : {title}",
        f"Resume : {summary or 'Non fourni'}",
    ]
    if lots_text:
        user_parts.append(lots_text)
    if url:
        user_parts.append(f"URL source : {url}")
    if instruction:
        user_parts.append(f"Instruction complementaire de l'utilisateur : {instruction}")

    user_parts.append(
        "\nAnalyse cet appel d'offres selon les regles du prompt systeme. "
        "Retourne uniquement le JSON demande."
    )

    user = "\n".join(user_parts)

    try:
        result = await complete_json(
            system=system,
            user=user,
            provider=provider,
            model=model,
        )
    except LLMUnavailable as exc:
        logger.warning("ao_analysis: LLM indisponible — %s", exc)
        return _stub_content(title, summary, lots, str(exc))
    except Exception as exc:  # noqa: BLE001 — on ne plante jamais
        logger.exception("ao_analysis: erreur inattendue lors de l'appel LLM")
        return _stub_content(title, summary, lots, str(exc))

    # Normalise each field defensively so the caller always gets a clean dict.
    synthese = str(result.get("synthese", "")).strip() or (
        f"Analyse de l'offre : {title}."
    )
    delais = str(result.get("delais", "")).strip() or "Non precise"
    recommandation = str(result.get("recommandation", "")).strip() or "A approfondir"

    return {
        "synthese": synthese,
        "lots": _lot_list(result.get("lots", lots)),
        "pieces_demandees": _str_list(result.get("pieces_demandees")),
        "criteres": _critere_list(result.get("criteres")),
        "delais": delais,
        "contraintes_dom": _str_list(result.get("contraintes_dom")),
        "risques": _str_list(result.get("risques")),
        "recommandation": recommandation,
    }

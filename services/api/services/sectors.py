"""Classification sectorielle BTP pour les appels d'offres DOM.

Source de vérité partagée entre le backend et le frontend (contrat V1+V2).
Ce module est volontairement sans dépendance lourde : il ne fait aucun import
SQLAlchemy, LLM ni réseau.

Fonctions publiques
-------------------
* :func:`classify_sectors` — retourne la liste des slugs sectoriels détectés.
* :func:`sector_label`     — retourne le libellé FR d'un slug.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Source de vérité : (slug, label FR, [mots-clés de détection])
# ---------------------------------------------------------------------------

SECTORS: list[tuple[str, str, list[str]]] = [
    (
        "placo",
        "Placo / Plâtrerie",
        ["placo", "plâtre", "platre", "plâtrerie", "ba13", "cloison", "doublage", "faux plafond"],
    ),
    (
        "electricite",
        "Électricité",
        ["électric", "electric", "courant", "tableau", "câblage", "cablage", "éclairage", "photovolta"],
    ),
    (
        "peinture",
        "Peinture",
        ["peinture", "peintre", "revêtement mural", "enduit décoratif"],
    ),
    (
        "carrelage",
        "Carrelage",
        ["carrelage", "carreleur", "faïence", "faience"],
    ),
    (
        "sol_souple",
        "Sol souple",
        ["sol souple", "pvc", "linoléum", "lino", "moquette", "revêtement de sol"],
    ),
    (
        "menuiserie",
        "Menuiserie",
        ["menuiserie", "menuisier", "fenêtre", "porte", "bois", "aluminium"],
    ),
    (
        "plomberie",
        "Plomberie",
        ["plomberie", "plombier", "sanitaire", "chauffe-eau"],
    ),
    (
        "maconnerie",
        "Maçonnerie",
        ["maçonnerie", "maconnerie", "maçon", "béton", "beton", "parpaing", "fondation"],
    ),
    (
        "couverture",
        "Couverture / Étanchéité",
        ["couverture", "toiture", "étanchéité", "etancheite", "zinguerie", "charpente"],
    ),
    (
        "vrd",
        "VRD / Terrassement",
        ["vrd", "terrassement", "voirie", "réseaux", "assainissement"],
    ),
    (
        "gros_oeuvre",
        "Gros œuvre",
        ["gros œuvre", "gros oeuvre", "structure"],
    ),
    (
        "second_oeuvre",
        "Second œuvre",
        ["second œuvre", "second oeuvre", "finition"],
    ),
]

# Fallback slug when no keyword matches.
_SLUG_AUTRE = "autre"

# Pre-built lookup for sector_label().
_LABEL_BY_SLUG: dict[str, str] = {slug: label for slug, label, _ in SECTORS}
_LABEL_BY_SLUG[_SLUG_AUTRE] = "Autre / Multi-lots"

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def classify_sectors(text: str, keywords_matched: list[str] | None) -> list[str]:
    """Retourne la liste des slugs sectoriels détectés dans *text* et *keywords_matched*.

    La comparaison est insensible à la casse. Les mots-clés issus du champ
    ``keywords_matched`` sont concaténés au texte principal avant la recherche.

    Paramètres
    ----------
    text:
        Chaîne libre (title + " " + summary typiquement).
    keywords_matched:
        Liste optionnelle de mots-clés déjà extraits par la veille.

    Retourne
    --------
    list[str]
        Liste de slugs (sans doublons, ordre de SECTORS), ou ``["autre"]``
        si aucun slug ne correspond.
    """
    extra = " ".join(keywords_matched) if keywords_matched else ""
    haystack = (text + " " + extra).lower()

    found: list[str] = []
    for slug, _label, keywords in SECTORS:
        if any(kw.lower() in haystack for kw in keywords):
            found.append(slug)

    return found if found else [_SLUG_AUTRE]


def sector_label(slug: str) -> str:
    """Retourne le libellé FR du slug, ou ``"Autre / Multi-lots"`` si inconnu."""
    return _LABEL_BY_SLUG.get(slug, _LABEL_BY_SLUG[_SLUG_AUTRE])

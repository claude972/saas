"""Serveur MCP btp-cockpit — donne à OpenClaw le contrôle total du cockpit BTP.

Ce serveur expose via le protocole MCP (stdio) tous les outils nécessaires pour
piloter l'API FastAPI du cockpit BTP OpenClaw. Il traduit chaque appel d'outil
en une requête HTTP REST vers le backend, gère l'authentification JWT avec cache
et re-authentification automatique sur 401, et renvoie des dicts JSON-sérialisables.

Lancement : python server.py  (stdio, compatible openclaw.json mcp.servers)
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Any

import httpx

# Chargement best-effort du fichier .env local
try:
    from dotenv import load_dotenv

    _env_path = os.path.join(os.path.dirname(__file__), ".env")
    load_dotenv(_env_path, override=False)
except ImportError:
    pass  # python-dotenv optionnel

from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
COCKPIT_API_URL: str = os.getenv("COCKPIT_API_URL", "http://localhost:8000").rstrip("/")
COCKPIT_EMAIL: str = os.getenv("COCKPIT_EMAIL", "admin@btp.local")
COCKPIT_PASSWORD: str = os.getenv("COCKPIT_PASSWORD", "changeme")

# ---------------------------------------------------------------------------
# Etat module-level : client httpx et cache du token JWT
# ---------------------------------------------------------------------------
_http_client: httpx.AsyncClient | None = None
_cached_token: str | None = None


def _client() -> httpx.AsyncClient:
    """Retourne le client httpx partagé, créé paresseusement."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=30.0)
    return _http_client


async def _login() -> str | None:
    """Authentifie contre /auth/login et met le token en cache. Retourne None si échec."""
    global _cached_token
    try:
        resp = await _client().post(
            f"{COCKPIT_API_URL}/auth/login",
            json={"email": COCKPIT_EMAIL, "password": COCKPIT_PASSWORD},
        )
        if resp.status_code == 200:
            _cached_token = resp.json()["access_token"]
            return _cached_token
        _cached_token = None
        return None
    except httpx.RequestError as exc:
        _cached_token = None
        return None


async def _request(
    method: str,
    path: str,
    *,
    json: dict | None = None,
    params: dict | None = None,
    _retry: bool = True,
) -> Any:
    """Effectue une requête HTTP authentifiée vers le cockpit.

    - Si aucun token en cache, s'authentifie d'abord.
    - Sur 401, ré-authentifie UNE seule fois et rejoue la requête.
    - Retourne le corps JSON parsé, ou {"error": "..."} en cas d'erreur.
    """
    global _cached_token

    # S'assurer d'avoir un token
    if _cached_token is None:
        token = await _login()
        if token is None:
            return {"error": "Authentification échouée — vérifier COCKPIT_EMAIL et COCKPIT_PASSWORD."}

    headers = {"Authorization": f"Bearer {_cached_token}"}

    try:
        resp = await _client().request(
            method,
            f"{COCKPIT_API_URL}{path}",
            headers=headers,
            json=json,
            params={k: v for k, v in (params or {}).items() if v is not None},
        )
    except httpx.RequestError as exc:
        return {"error": f"Erreur réseau : {exc}"}

    # Ré-authentification sur 401
    if resp.status_code == 401 and _retry:
        _cached_token = None
        token = await _login()
        if token is None:
            return {"error": "Ré-authentification échouée après expiration du token."}
        return await _request(method, path, json=json, params=params, _retry=False)

    # Réponse sans corps (204, etc.)
    if resp.status_code == 204 or not resp.content:
        return {"status": "ok", "http_status": resp.status_code}

    try:
        data = resp.json()
    except Exception:
        return {"error": f"Réponse non-JSON (HTTP {resp.status_code}) : {resp.text[:300]}"}

    if resp.status_code >= 400:
        detail = data.get("detail", data) if isinstance(data, dict) else data
        return {"error": f"HTTP {resp.status_code} — {detail}"}

    return data


# ---------------------------------------------------------------------------
# Heartbeat — signale la présence d'OpenClaw au cockpit toutes les 30 s
# ---------------------------------------------------------------------------
async def _heartbeat_loop() -> None:
    """Tâche de fond : POST /openclaw/heartbeat toutes les 30 secondes.

    Best-effort : toutes les erreurs réseau ou d'authentification sont
    ignorées silencieusement afin de ne jamais bloquer le serveur MCP.
    """
    while True:
        try:
            await _request("POST", "/openclaw/heartbeat", json={})
        except Exception:
            pass
        await asyncio.sleep(30)


@asynccontextmanager
async def _lifespan(server: Any):
    """Cycle de vie FastMCP : démarre la boucle de heartbeat au lancement."""
    task = asyncio.create_task(_heartbeat_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


# ---------------------------------------------------------------------------
# Instance FastMCP
# ---------------------------------------------------------------------------
mcp = FastMCP("btp-cockpit", lifespan=_lifespan)


# ---------------------------------------------------------------------------
# Outils — Santé
# ---------------------------------------------------------------------------
@mcp.tool()
async def health() -> dict:
    """Vérifie l'état de santé du backend cockpit et du LLM configuré.

    Utiliser cet outil pour s'assurer que le serveur FastAPI est démarré et que
    le modèle de langage est disponible avant d'envoyer des commandes.
    Retourne {"status": "ok", "llm": true/false} si tout va bien.
    """
    try:
        resp = await _client().get(f"{COCKPIT_API_URL}/health", timeout=10.0)
        return resp.json()
    except httpx.RequestError as exc:
        return {"error": f"Backend injoignable : {exc}"}


# ---------------------------------------------------------------------------
# Outils — Commandes OpenClaw
# ---------------------------------------------------------------------------
@mcp.tool()
async def send_command(
    instruction: str,
    project_id: str | None = None,
    intent: str | None = None,
) -> dict:
    """Envoie un ordre en langage naturel au cockpit BTP pour traitement asynchrone.

    C'est l'outil principal d'OpenClaw : soumettre une instruction permet de
    déclencher l'orchestration automatique (classification d'intention, routage
    vers un agent, création de tâche, génération de document, évaluation du
    risque et demande de validation humaine si nécessaire).

    Paramètres :
    - instruction : l'ordre en langage naturel (ex. "Crée un devis pour la
      rénovation de la toiture du client Dupont").
    - project_id : UUID du projet à associer (optionnel).
    - intent : intention explicite parmi analyze_photo, create_quote,
      create_quote_from_photo, create_site_report, analyze_tender
      (optionnel — le backend classifie automatiquement si absent).

    Le backend traite la commande en arrière-plan et retourne immédiatement
    la commande créée avec son statut "received".

    Note : pour remonter les appels d'offres BTP détectés par la veille
    automatique, utiliser list_new_offers (liste les offres status="new")
    plutôt que send_command.
    """
    body: dict[str, Any] = {"source": "openclaw", "instruction": instruction}
    if project_id is not None:
        body["project_id"] = project_id
    if intent is not None:
        body["intent"] = intent
    return await _request("POST", "/openclaw/command", json=body)


@mcp.tool()
async def list_commands() -> list | dict:
    """Liste les dernières commandes OpenClaw soumises au cockpit (50 les plus récentes).

    Utiliser cet outil pour suivre l'avancement des instructions envoyées via
    send_command : voir leur statut (received, processing, completed, failed),
    l'intention classifiée, et les tâches associées.
    """
    return await _request("GET", "/openclaw/commands")


@mcp.tool()
async def get_command(command_id: str) -> dict:
    """Récupère le détail d'une commande OpenClaw par son UUID.

    Utiliser cet outil pour inspecter une commande précise : son statut,
    l'intention détectée, et les éventuels messages d'erreur.

    Paramètre :
    - command_id : UUID de la commande (obtenu via list_commands ou send_command).
    """
    return await _request("GET", f"/openclaw/commands/{command_id}")


# ---------------------------------------------------------------------------
# Outils — Projets (chantiers)
# ---------------------------------------------------------------------------
@mcp.tool()
async def list_projects() -> list | dict:
    """Liste tous les projets (chantiers / affaires) du cockpit, du plus récent au plus ancien.

    Utiliser cet outil pour obtenir un aperçu de tous les chantiers en cours,
    récupérer leurs UUIDs (nécessaires pour les autres outils), ou vérifier
    leur statut.
    """
    return await _request("GET", "/projects")


@mcp.tool()
async def get_project(project_id: str) -> dict:
    """Récupère le détail complet d'un projet par son UUID.

    Utiliser cet outil pour obtenir toutes les informations d'un chantier
    (nom, client, adresse, type, statut, description, dates de création/mise à jour).

    Paramètre :
    - project_id : UUID du projet.
    """
    return await _request("GET", f"/projects/{project_id}")


@mcp.tool()
async def create_project(
    name: str,
    client_name: str,
    address: str | None = None,
    project_type: str | None = None,
    description: str | None = None,
) -> dict:
    """Crée un nouveau projet (chantier / affaire) dans le cockpit.

    Utiliser cet outil quand un nouveau chantier doit être enregistré dans le
    système avant d'y associer des commandes, tâches ou documents.

    Paramètres :
    - name : nom du projet / chantier (obligatoire).
    - client_name : nom du client / maître d'ouvrage (obligatoire).
    - address : adresse du chantier (optionnel).
    - project_type : type de chantier ex. "renovation", "construction_neuve" (optionnel).
    - description : description libre (optionnel).
    """
    body: dict[str, Any] = {"name": name, "client_name": client_name}
    if address is not None:
        body["address"] = address
    if project_type is not None:
        body["project_type"] = project_type
    if description is not None:
        body["description"] = description
    return await _request("POST", "/projects", json=body)


@mcp.tool()
async def update_project(
    project_id: str,
    name: str | None = None,
    client_name: str | None = None,
    address: str | None = None,
    project_type: str | None = None,
    status: str | None = None,
    description: str | None = None,
) -> dict:
    """Met à jour partiellement un projet existant (PATCH).

    Utiliser cet outil pour modifier les informations d'un chantier : renommer,
    changer le client, l'adresse, le type, la description, ou faire passer
    le statut à "active", "completed", "on_hold", etc.

    Seuls les champs fournis (non-None) sont envoyés au backend.

    Paramètre obligatoire :
    - project_id : UUID du projet à modifier.
    """
    body: dict[str, Any] = {}
    if name is not None:
        body["name"] = name
    if client_name is not None:
        body["client_name"] = client_name
    if address is not None:
        body["address"] = address
    if project_type is not None:
        body["project_type"] = project_type
    if status is not None:
        body["status"] = status
    if description is not None:
        body["description"] = description
    return await _request("PATCH", f"/projects/{project_id}", json=body)


# ---------------------------------------------------------------------------
# Outils — Agents
# ---------------------------------------------------------------------------
@mcp.tool()
async def list_agents() -> list | dict:
    """Liste tous les agents enregistrés dans le cockpit.

    Utiliser cet outil pour voir quels agents sont disponibles, connaître leur
    slug, statut (idle/running), s'ils sont activés, et obtenir leur UUID pour
    les opérations run/enable/disable.
    """
    return await _request("GET", "/agents")


@mcp.tool()
async def get_agent(agent_id: str) -> dict:
    """Récupère les informations détaillées d'un agent par son UUID.

    Utiliser cet outil pour inspecter la configuration d'un agent spécifique :
    son slug, son nom, sa description, son statut, et s'il est activé.

    Paramètre :
    - agent_id : UUID de l'agent.
    """
    return await _request("GET", f"/agents/{agent_id}")


@mcp.tool()
async def run_agent(agent_id: str, instruction: str | None = None) -> dict:
    """Déclenche manuellement l'exécution d'un agent.

    Utiliser cet outil pour lancer un agent directement, sans passer par
    send_command. Le backend crée une tâche, l'exécute en arrière-plan en
    suivant le même pipeline (risque, approbation, audit) que pour les
    commandes normales, et retourne la tâche créée (statut "running").

    L'outil retourne une erreur si l'agent est désactivé ou non enregistré
    dans le registre interne.

    Paramètres :
    - agent_id : UUID de l'agent à exécuter.
    - instruction : instruction optionnelle à passer à l'agent (remplace
      la description par défaut de l'agent).
    """
    body: dict[str, Any] = {}
    if instruction is not None:
        body["instruction"] = instruction
    return await _request("POST", f"/agents/{agent_id}/run", json=body)


@mcp.tool()
async def enable_agent(agent_id: str) -> dict:
    """Active un agent désactivé (enabled = True).

    Utiliser cet outil pour réactiver un agent qui avait été désactivé,
    afin qu'il puisse à nouveau être utilisé par le command router ou
    déclenché manuellement.

    Paramètre :
    - agent_id : UUID de l'agent à activer.
    """
    return await _request("POST", f"/agents/{agent_id}/enable")


@mcp.tool()
async def disable_agent(agent_id: str) -> dict:
    """Désactive un agent (enabled = False).

    Utiliser cet outil pour empêcher un agent d'être utilisé par le command
    router ou déclenché manuellement, sans le supprimer du registre.

    Paramètre :
    - agent_id : UUID de l'agent à désactiver.
    """
    return await _request("POST", f"/agents/{agent_id}/disable")


# ---------------------------------------------------------------------------
# Outils — Tâches
# ---------------------------------------------------------------------------
@mcp.tool()
async def list_tasks(
    status: str | None = None,
    project_id: str | None = None,
) -> list | dict:
    """Liste les tâches du cockpit, avec filtres optionnels.

    Utiliser cet outil pour suivre l'avancement des tâches créées par le
    command router ou par des runs manuels d'agents. Les tâches reflètent
    le travail effectif des agents.

    Paramètres :
    - status : filtrer par statut parmi pending, running, completed, failed,
      waiting_approval (optionnel).
    - project_id : filtrer par UUID de projet (optionnel).
    """
    return await _request(
        "GET",
        "/tasks",
        params={"status": status, "project_id": project_id},
    )


@mcp.tool()
async def get_task(task_id: str) -> dict:
    """Récupère le détail d'une tâche par son UUID.

    Utiliser cet outil pour inspecter une tâche précise : son statut, son
    instruction, le résultat de l'agent, les éventuelles erreurs, et les
    métadonnées de timing.

    Paramètre :
    - task_id : UUID de la tâche.
    """
    return await _request("GET", f"/tasks/{task_id}")


# ---------------------------------------------------------------------------
# Outils — Validations humaines (approvals)
# ---------------------------------------------------------------------------
@mcp.tool()
async def list_approvals(status: str | None = None) -> list | dict:
    """Liste les demandes de validation humaine, avec filtre optionnel par statut.

    Utiliser cet outil pour voir quelles sorties d'agents attendent une
    décision humaine (devis à envoyer, rapports de chantier, réponses à appels
    d'offres). C'est le point d'entrée principal pour le workflow de validation.

    Paramètre :
    - status : filtrer par "pending", "accepted" ou "rejected" (optionnel).
    """
    return await _request("GET", "/approvals", params={"status": status})


@mcp.tool()
async def accept_approval(approval_id: str, note: str | None = None) -> dict:
    """Accepte une validation humaine en attente et finalise la tâche et le document associés.

    Utiliser cet outil quand un devis, rapport ou document généré par un agent
    est correct et peut être finalisé / envoyé au client. Le backend passe le
    document de DRAFT à APPROVED et la tâche à COMPLETED.

    ATTENTION : cette action a des effets irréversibles (finalisation du document).
    Vérifier le contenu via get_document avant d'accepter.

    Paramètres :
    - approval_id : UUID de la validation à accepter.
    - note : commentaire optionnel justifiant la décision.
    """
    body: dict[str, Any] = {}
    if note is not None:
        body["note"] = note
    return await _request("POST", f"/approvals/{approval_id}/accept", json=body)


@mcp.tool()
async def reject_approval(approval_id: str, note: str | None = None) -> dict:
    """Rejette une validation humaine en attente et annule la tâche et le document associés.

    Utiliser cet outil quand un document généré est incorrect ou ne doit pas
    être finalisé. Le backend passe le document à CANCELLED et la tâche à FAILED.

    Paramètres :
    - approval_id : UUID de la validation à rejeter.
    - note : raison du rejet (fortement recommandé pour l'audit trail).
    """
    body: dict[str, Any] = {}
    if note is not None:
        body["note"] = note
    return await _request("POST", f"/approvals/{approval_id}/reject", json=body)


# ---------------------------------------------------------------------------
# Outils — Documents
# ---------------------------------------------------------------------------
@mcp.tool()
async def list_documents(
    project_id: str | None = None,
    status: str | None = None,
) -> list | dict:
    """Liste les documents générés par les agents, avec filtres optionnels.

    Utiliser cet outil pour voir les devis, rapports de chantier, réponses
    à appels d'offres et autres documents produits par le cockpit. Indispensable
    avant d'accepter/rejeter une validation pour en vérifier le contenu.

    Paramètres :
    - project_id : filtrer par UUID de projet (optionnel).
    - status : filtrer par statut parmi draft, waiting_approval, approved,
      rejected, cancelled (optionnel).
    """
    return await _request(
        "GET",
        "/documents",
        params={"project_id": project_id, "status": status},
    )


@mcp.tool()
async def create_document(
    document_type: str,
    title: str,
    content: dict | None = None,
    project_id: str | None = None,
) -> dict:
    """Crée un nouveau document (ex. compte rendu d'intervention) en brouillon.

    Utiliser pour créer un document que l'agent va remplir ensuite via
    update_document. Le rendu (trame) est fixe côté serveur : seul le contenu
    (content) définit le modèle.

    Types utiles :
    - "intervention" : compte rendu d'intervention (export brandé OM²/CED/
      Suivisio/Brume, comme les devis).
    - "quote" : devis.

    Champs content d'un compte rendu "intervention" (tous optionnels) :
      reference, emitted_at, client_name, client_address, client_phone,
      client_email, intervention_address, date_intervention, heure_arrivee,
      heure_depart, technicien, fonction, meteo,
      type_options (liste), type_checked (liste),
      objet (texte), travaux_options (liste), travaux_checked (liste),
      commentaires (texte),
      photos (liste de {caption, url, description}),
      materiel (liste de {designation, reference, quantite}),
      reserves (texte).

    Paramètres :
    - document_type : ex. "intervention".
    - title : titre du document.
    - content : dict du contenu initial (optionnel).
    - project_id : UUID de projet à rattacher (optionnel).

    Retourne le document créé, ou {"error": "..."}.
    """
    payload: dict = {"document_type": document_type, "title": title}
    if content is not None:
        payload["content"] = content
    if project_id:
        payload["project_id"] = project_id
    return await _request("POST", "/documents", json=payload)


@mcp.tool()
async def get_document(document_id: str) -> dict:
    """Récupère le détail complet d'un document par son UUID, y compris son contenu.

    Utiliser cet outil pour lire le contenu d'un devis, rapport ou autre
    document avant de prendre une décision de validation, ou pour en extraire
    des informations spécifiques.

    Paramètre :
    - document_id : UUID du document.
    """
    return await _request("GET", f"/documents/{document_id}")


@mcp.tool()
async def update_document(document_id: str, content: dict) -> dict:
    """Met à jour le contenu d'un document existant (devis, rapport, etc.) via PATCH.

    Utiliser cet outil pour modifier les lignes d'un devis, corriger les
    informations d'un rapport de chantier ou ajuster n'importe quel champ
    du contenu JSON d'un document. Le backend recalcule automatiquement les
    totaux HT/TVA/TTC si le document est de type « quote ».

    Si le document était déjà approuvé ou envoyé, la modification le repasse
    en « waiting_approval » et crée une nouvelle demande de validation humaine.

    Paramètres :
    - document_id : UUID du document à modifier.
    - content     : dict JSON représentant le nouveau contenu du document
                    (ex. {"lines": [...], "client_name": "Dupont"}).

    Retourne le document mis à jour ou un dict {"error": "..."} en cas d'échec.
    """
    return await _request("PATCH", f"/documents/{document_id}", json={"content": content})


@mcp.tool()
async def send_document_email(
    document_id: str,
    to: str,
    subject: str = "",
    message: str = "",
    brand: str = "pdf",
) -> dict:
    """Envoie IMMÉDIATEMENT un devis par email (sans validation humaine).

    Le PDF est généré et envoyé au destinataire via le relais SMTP. À utiliser
    quand l'agent doit envoyer directement. Pour passer par une validation
    humaine avant envoi, utiliser plutôt ``request_document_email``.

    Paramètres :
    - document_id : UUID du devis/document à envoyer.
    - to          : adresse email du destinataire.
    - subject     : objet du mail (optionnel ; objet par défaut sinon).
    - message     : corps du mail (optionnel ; texte par défaut sinon).
    - brand       : variante du PDF — "pdf"/"om2" (rouge), "ced" (vert),
                    "suivisio" (bleu) ou "brume" (Brume Caraïbes, bleu).

    Retourne {"status":"sent","to":...,"filename":...} ou {"error":"..."}.
    """
    return await _request(
        "POST",
        f"/documents/{document_id}/email",
        json={"to": to, "subject": subject, "message": message, "brand": brand},
    )


@mcp.tool()
async def add_intervention_photo(
    document_id: str,
    image_url: str | None = None,
    image_base64: str | None = None,
    caption: str = "",
    description: str = "",
    slot: int | None = None,
) -> dict:
    """Attache une VRAIE photo à un compte rendu d'intervention.

    À utiliser quand une photo est reçue (ex. via Telegram) : le backend
    télécharge/décode l'image, la convertit en JPEG et la stocke dans le
    compte rendu → elle apparaît dans le PDF export. Ne PAS mettre une URL ou un
    nom de fichier dans le champ `url` via update_document : cela donne un cadre
    cassé. Utiliser CET outil à la place.

    Fournir l'un des deux :
    - image_url : URL téléchargeable de l'image (ex. lien de fichier Telegram).
    - image_base64 : contenu de l'image en base64 (data URI accepté).

    Paramètres :
    - document_id : UUID du compte rendu (type "intervention").
    - caption : légende (ex. "Avant intervention").
    - description : commentaire sous la photo.
    - slot : index 0-based de l'emplacement à remplir ; omettre pour ajouter à la fin.

    Retourne {"status":"ok","index":...,"count":...} ou {"error":"..."}.
    """
    return await _request(
        "POST",
        f"/documents/{document_id}/photo",
        json={
            "image_url": image_url,
            "image_base64": image_base64,
            "caption": caption,
            "description": description,
            "slot": slot,
        },
    )


@mcp.tool()
async def request_document_email(
    document_id: str,
    to: str,
    subject: str = "",
    message: str = "",
    brand: str = "pdf",
) -> dict:
    """Demande l'envoi d'un devis par email — crée une VALIDATION HUMAINE.

    L'email n'est PAS envoyé immédiatement : une demande de validation est
    créée. Un humain l'accepte dans le cockpit (section Validations), et c'est
    seulement à ce moment que le PDF est généré et envoyé au destinataire.

    Paramètres :
    - document_id : UUID du devis/document à envoyer.
    - to          : adresse email du destinataire.
    - subject     : objet du mail (optionnel ; un objet par défaut sinon).
    - message     : corps du mail (optionnel ; un texte par défaut sinon).
    - brand       : variante du PDF — "pdf"/"om2" (rouge), "ced" (vert),
                    "suivisio" (bleu) ou "brume" (Brume Caraïbes, bleu).

    Retourne la demande de validation créée, ou {"error": "..."} en cas d'échec.
    """
    return await _request(
        "POST",
        f"/documents/{document_id}/email/request-approval",
        json={"to": to, "subject": subject, "message": message, "brand": brand},
    )


# ---------------------------------------------------------------------------
# Outils — Journal d'audit (logs)
# ---------------------------------------------------------------------------
@mcp.tool()
async def list_logs(
    level: str | None = None,
    event_type: str | None = None,
    limit: int | None = None,
) -> list | dict:
    """Liste les entrées du journal d'audit du cockpit, du plus récent au plus ancien.

    Utiliser cet outil pour comprendre ce qui s'est passé dans le cockpit :
    commandes reçues, agents déclenchés, documents générés, validations
    demandées/tranchées, erreurs, etc. Essentiel pour le débogage et le suivi.

    Paramètres :
    - level : filtrer par niveau parmi "info", "warning", "error" (optionnel).
    - event_type : filtrer par type d'événement ex. "agent.run", "document.generated",
      "approval.requested", "task.completed" (optionnel).
    - limit : nombre maximum d'entrées retournées, entre 1 et 1000 (défaut 100).
    """
    return await _request(
        "GET",
        "/logs",
        params={"level": level, "event_type": event_type, "limit": limit},
    )


@mcp.tool()
async def list_project_logs(project_id: str) -> list | dict:
    """Liste les entrées du journal d'audit pour un projet (chantier) spécifique.

    Utiliser cet outil pour obtenir l'historique complet de tout ce qui s'est
    passé sur un chantier donné : commandes, tâches, documents, validations,
    erreurs — filtré par projet.

    Retourne 404 si le projet n'existe pas.

    Paramètre :
    - project_id : UUID du projet dont on veut l'historique.
    """
    return await _request("GET", f"/logs/{project_id}")


# ---------------------------------------------------------------------------
# Outils — Appels d'offres (veille BTP)
# ---------------------------------------------------------------------------
@mcp.tool()
async def list_new_offers(limit: int = 20) -> list | dict:
    """Liste les appels d'offres BTP récemment détectés par la veille, au statut "new".

    Utiliser cet outil pour consulter les nouvelles opportunités remontées
    automatiquement par la veille Perplexity ou browser_use : chaque offre
    contient un titre, un résumé, l'organisation émettrice, les lots, la région,
    la date limite de réponse et un score de pertinence.

    C'est le point d'entrée principal d'OpenClaw pour traiter les appels d'offres :
    après consultation, utiliser analyze_tender_offer pour produire une analyse
    structurée, puis update_tender (via l'API directe) pour changer le statut.

    Paramètre :
    - limit : nombre maximum d'offres à retourner (défaut 20, max 100).
    """
    return await _request("GET", "/tenders/new", params={"limit": limit})


@mcp.tool()
async def list_tenders(
    status: str | None = None,
    region: str | None = None,
    limit: int = 20,
) -> list | dict:
    """Liste les appels d'offres BTP enregistrés dans le cockpit, avec filtres optionnels.

    Utiliser cet outil pour parcourir l'ensemble du pipeline d'appels d'offres :
    nouvelles offres (new), en cours d'analyse (analyzing), avec réponse soumise
    (responded), ou ignorées (ignored).

    Paramètres :
    - status : filtrer par statut parmi "new", "seen", "analyzing", "responded",
      "ignored" (optionnel).
    - region : filtrer par région DOM ex. "Martinique", "Guadeloupe", "La Réunion"
      (optionnel).
    - limit : nombre maximum d'offres retournées (défaut 20, max 100).
    """
    return await _request(
        "GET",
        "/tenders",
        params={"status": status, "region": region, "limit": limit},
    )


@mcp.tool()
async def get_tender(tender_id: str) -> dict:
    """Récupère le détail complet d'un appel d'offres par son UUID.

    Utiliser cet outil pour inspecter une offre précise avant de lancer son
    analyse : titre, résumé, lots, organisation, localisation, date limite,
    score de pertinence, mots-clés appariés, et lien vers le document d'analyse
    s'il a déjà été produit (document_id).

    Paramètre :
    - tender_id : UUID de l'appel d'offres.
    """
    return await _request("GET", f"/tenders/{tender_id}")


@mcp.tool()
async def analyze_tender_offer(
    tender_id: str,
    instruction: str | None = None,
) -> dict:
    """Lance l'analyse IA d'un appel d'offres BTP et génère un document d'analyse structuré.

    Utiliser cet outil pour demander au cockpit une analyse complète d'une offre :
    synthèse exécutive, décomposition des lots, pièces à fournir, critères de
    sélection, délais, contraintes DOM, risques identifiés et recommandation finale.

    Le backend crée un Document de type "analyse_ao" (statut draft), met à jour
    l'offre en statut "responded", et retourne le document créé. Ce document peut
    ensuite être soumis à validation via list_approvals / accept_approval.

    Paramètres :
    - tender_id  : UUID de l'appel d'offres à analyser (obligatoire).
    - instruction : consigne complémentaire pour orienter l'analyse, ex.
      "Insiste sur les risques liés au transport maritime interîles" (optionnel).
    """
    body: dict[str, Any] = {}
    if instruction is not None:
        body["instruction"] = instruction
    return await _request("POST", f"/tenders/{tender_id}/analyze", json=body)


# ---------------------------------------------------------------------------
# Outils — Veille automatique (configuration et déclenchement)
# ---------------------------------------------------------------------------
@mcp.tool()
async def run_veille_now() -> dict:
    """Déclenche immédiatement un cycle de veille BTP et retourne les offres trouvées.

    Utiliser cet outil pour forcer une recherche manuelle d'appels d'offres sans
    attendre le prochain cycle planifié. La veille interroge les sources configurées
    (Perplexity, browser_use), déduplique les résultats et insère les nouvelles
    offres en base avec le statut "new".

    Retourne {"count": n, "new_ids": ["uuid1", ...]} indiquant le nombre d'offres
    nouvellement insérées et leurs identifiants. Après exécution, utiliser
    list_new_offers pour consulter les offres récupérées.
    """
    return await _request("POST", "/veille/run")


@mcp.tool()
async def get_veille_config() -> dict:
    """Récupère la configuration actuelle de la veille automatique BTP.

    Utiliser cet outil pour connaître l'état de la veille planifiée : si elle
    est activée, l'intervalle entre les cycles (en minutes), la fenêtre de
    silence (quiet_start/quiet_end en heures), les mots-clés surveillés, les
    régions DOM ciblées, les sources interrogées (perplexity, browser_use),
    ainsi que les informations sur le dernier et le prochain cycle.
    """
    return await _request("GET", "/veille/config")


@mcp.tool()
async def set_veille_config(
    enabled: bool | None = None,
    interval_minutes: int | None = None,
    quiet_start: int | None = None,
    quiet_end: int | None = None,
) -> dict:
    """Met à jour la configuration de la veille automatique BTP (champs non-None uniquement).

    Utiliser cet outil pour activer ou désactiver la veille planifiée, ajuster
    sa fréquence, ou définir une fenêtre de silence pendant laquelle aucun cycle
    ne se déclenche (ex. quiet_start=22, quiet_end=6 pour ne pas chercher la nuit).

    Pour modifier les mots-clés, les régions ou les sources, utiliser directement
    l'API REST PUT /veille/config avec le champ correspondant.

    Seuls les paramètres fournis (non-None) sont transmis au backend.

    Paramètres :
    - enabled         : True pour activer la veille planifiée, False pour la mettre
                        en pause (optionnel).
    - interval_minutes: intervalle entre deux cycles en minutes, ex. 120 pour
                        toutes les 2 heures (optionnel).
    - quiet_start     : heure de début de la fenêtre de silence (0-23, inclusif),
                        ex. 22 pour commencer à 22h (optionnel).
    - quiet_end       : heure de fin de la fenêtre de silence (0-23, inclusif),
                        ex. 6 pour reprendre à 6h du matin (optionnel).
    """
    body: dict[str, Any] = {}
    if enabled is not None:
        body["enabled"] = enabled
    if interval_minutes is not None:
        body["interval_minutes"] = interval_minutes
    if quiet_start is not None:
        body["quiet_start"] = quiet_start
    if quiet_end is not None:
        body["quiet_end"] = quiet_end
    return await _request("PUT", "/veille/config", json=body)


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    mcp.run()

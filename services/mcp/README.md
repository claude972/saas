# btp-cockpit — Serveur MCP

Ce serveur MCP expose le cockpit BTP OpenClaw comme source d'outils pour le client MCP local OpenClaw.
Il fait le pont entre les instructions d'OpenClaw (transport stdio) et l'API REST FastAPI du cockpit.
OpenClaw obtient un controle total : projets, agents, taches, validations, documents, logs — tout passe par ce serveur.

Le backend reste l'autorite : les validations humaines (devis, envois client) sont traitees cote cockpit, pas contournees ici.

---

## Installation

```bash
cd /Users/claudebrafa/dev/saas/services/mcp
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Editer .env avec les vraies valeurs si necessaire
```

---

## Configuration OpenClaw

Coller le bloc suivant dans `~/.openclaw/openclaw.json`, sous la cle `mcp.servers` :

```json
{
  "mcp": {
    "servers": {
      "btp-cockpit": {
        "command": "/Users/claudebrafa/dev/saas/services/mcp/.venv/bin/python",
        "args": ["/Users/claudebrafa/dev/saas/services/mcp/server.py"],
        "transport": "stdio",
        "env": {
          "COCKPIT_API_URL": "http://localhost:8000",
          "COCKPIT_EMAIL": "admin@btp.local",
          "COCKPIT_PASSWORD": "changeme"
        }
      }
    }
  }
}
```

Puis relancer le gateway :

```bash
openclaw gateway --port 18789
```

Ou redemarrer le daemon OpenClaw si celui-ci tourne en arriere-plan.

---

## Outils exposes

### Systeme
- `health` — etat du backend et du LLM

### Commandes OpenClaw
- `send_command` — envoie un ordre au cockpit (instruction libre, projet optionnel, intent optionnel)
- `list_commands` — historique des commandes recues
- `get_command` — detail d'une commande par ID

### Projets
- `list_projects` — liste tous les projets
- `get_project` — detail d'un projet par ID
- `create_project` — cree un nouveau projet
- `update_project` — modifie un projet existant (nom, client, adresse, type, statut, description)

### Agents
- `list_agents` — liste les agents disponibles
- `get_agent` — detail d'un agent par ID
- `run_agent` — declenche l'execution d'un agent
- `enable_agent` — active un agent
- `disable_agent` — desactive un agent

### Taches
- `list_tasks` — liste les taches (filtre optionnel par statut et/ou projet)
- `get_task` — detail d'une tache par ID

### Validations
- `list_approvals` — liste les validations en attente (filtre optionnel par statut)
- `accept_approval` — accepte une validation (note optionnelle)
- `reject_approval` — rejette une validation (note optionnelle)

### Documents
- `list_documents` — liste les documents (filtre optionnel par projet et/ou statut)
- `get_document` — detail d'un document par ID

### Logs
- `list_logs` — journal global (filtre optionnel par niveau, type d'evenement, limite)
- `list_project_logs` — journal d'un projet specifique

---

## Exemple d'usage

Demander a OpenClaw :

> "Prepare un devis placo-peinture pour Villa Ducos"

OpenClaw appellera `send_command` avec l'instruction et l'intent `create_quote`. Le cockpit cree la tache, la soumet a validation humaine si necessaire, puis genere le document.

---

## Securite

OpenClaw propose, le backend valide.

- Les devis et envois client passent par une validation humaine dans le cockpit avant tout effet reel.
- Ce serveur MCP ne contourne aucune regle metier : il relaie uniquement vers l'API REST.
- Ne jamais stocker de mot de passe en clair dans le depot — utiliser `.env` (ignore par git).
- Le token JWT est mis en cache en memoire uniquement, pour la duree de vie du processus.

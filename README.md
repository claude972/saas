# BTP OpenClaw Cockpit

SaaS interne — cockpit BTP piloté par **OpenClaw** (agent maître).

Le backend **FastAPI est l'autorité**. Il reçoit une commande d'OpenClaw, classe l'intention (LLM),
choisit un sous-agent via une whitelist, crée une tâche, exécute l'agent (Claude), génère des
documents (toujours en **brouillon**), crée des **validations humaines** pour les actions sensibles,
et **journalise tout**. OpenClaw n'écrit jamais directement en base ni dans les fichiers.

## Stack

- **Frontend** — `apps/web` : Next.js 14 (App Router), TypeScript, Tailwind CSS, lucide-react.
- **Backend** — `services/api` : FastAPI, SQLAlchemy 2.0 async (asyncpg), Pydantic v2, PostgreSQL, SDK `anthropic`.
- **Base de données** — PostgreSQL via Docker Compose.
- **Auth** — JWT maison (login email + mot de passe), vérifié côté FastAPI.
- **Fichiers** — stockage local `services/api/storage/files` (dev).

## Arborescence

```
saas/
├── docker-compose.yml          # PostgreSQL 16
├── Makefile                    # raccourcis db / api / web / seed
├── .env.example                # variables Docker (rappel)
├── README.md
├── design/
│   └── cockpit-dashboard.html  # source de vérité du design
├── docs/
├── apps/
│   └── web/                    # Next.js 14 (App Router)
│       ├── app/
│       ├── components/
│       └── lib/
└── services/
    └── api/                    # FastAPI
        ├── main.py
        ├── config.py
        ├── database.py
        ├── deps.py
        ├── models.py
        ├── schemas.py
        ├── enums.py
        ├── seed.py
        ├── core/               # security, command_router, risk_engine, approval_engine, audit_logger
        ├── agents/             # base, llm, registry + 4 agents IA
        ├── routes/             # auth, openclaw, projects, agents, tasks, approvals, documents, logs
        ├── mcp_gateway/        # scaffold (passerelle MCP, à construire plus tard)
        └── storage/files/      # fichiers uploadés (dev)
```

## Démarrage local (pas à pas)

### 1. Base de données

```bash
docker compose up -d db
```

La base PostgreSQL écoute sur `localhost:5432` (user/password/db = `openclaw`).

### 2. Backend (FastAPI)

```bash
cd services/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8000
```

L'API démarre sur http://localhost:8000 (docs interactives : http://localhost:8000/docs).
Au démarrage, les tables sont créées et les agents sont semés automatiquement si la table est vide.

### 3. Frontend (Next.js)

```bash
cd apps/web
npm install
cp .env.local.example .env.local
npm run dev
```

Le cockpit est disponible sur http://localhost:3000.

### 4. Connexion par défaut

```
email    : admin@btp.local
mot de passe : changeme
```

(Identifiants définis via variables d'environnement côté backend.)

## Notes

### `ANTHROPIC_API_KEY`

- **Sans clé** : les agents IA renvoient des résultats **stub** (clairement marqués `{"stub": true, ...}`)
  qui respectent le format attendu. L'application reste **entièrement fonctionnelle**.
- **Avec clé** : devis, analyses de photos (vision) et autres productions sont **réels** (Claude).

Ajoutez la clé dans `services/api/.env` :

```
ANTHROPIC_API_KEY=sk-ant-...
```

### `OPENCLAW_MODEL`

Le modèle Claude utilisé est configurable via `OPENCLAW_MODEL` (défaut : `claude-opus-4-8`).

## Raccourcis Makefile

```bash
make db       # démarre la base (docker compose, détaché)
make db-down  # arrête la base
make api      # lance le backend (uvicorn, port 8000)
make web      # lance le frontend (port 3000)
make seed     # seed la base (agents, données de démo)
```

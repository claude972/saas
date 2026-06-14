# Architecture — BTP OpenClaw Cockpit

> Document technique de référence. Décrit l'architecture **réellement implémentée**
> du SaaS interne « BTP OpenClaw Cockpit ». Aucune fonctionnalité non codée n'est
> documentée ici.

---

## 1. Vue d'ensemble

Le **BTP OpenClaw Cockpit** est un cockpit interne pour entreprise du BTP, piloté
par **OpenClaw** (l'agent maître). Le principe directeur est que **le backend
FastAPI est l'autorité** : OpenClaw n'écrit jamais directement en base ni sur le
système de fichiers. Il se contente de **soumettre une commande en langage
naturel** ; le backend prend ensuite toutes les décisions.

Chaîne de traitement d'une commande :

```
OpenClaw
   │  POST /openclaw/command  (instruction en langage naturel)
   ▼
Backend FastAPI (autorité)
   ├─ 1. Classe l'intention (whitelist → LLM → heuristique mots-clés FR)
   ├─ 2. Résout un sous-agent via une WHITELIST stricte (rejet si hors liste / désactivé)
   ├─ 3. Crée une task (status running)
   ├─ 4. Exécute l'agent (Claude) → résultat dict
   ├─ 5. Persiste le document généré (TOUJOURS en draft)
   ├─ 6. Calcule le risque + ouvre une validation humaine si nécessaire
   └─ 7. Journalise CHAQUE étape (table logs)
```

Garde-fous de la V1 (appliqués dans le code) :

- **Aucune écriture directe par OpenClaw** : seul le backend persiste.
- **Documents toujours créés en `draft`** (les agents ne persistent rien eux-mêmes).
- **Whitelist d'intentions** : une intention hors whitelist fait échouer la commande.
- **Validation humaine** obligatoire pour les sorties sensibles (devis, réponse AO,
  sorties client, risque élevé).
- **Pas de suppression définitive** : seuls des changements de statut (soft).
- **Journalisation exhaustive** : table `logs` en append-only.
- **Mode dégradé fonctionnel** : sans clé API Anthropic, les agents renvoient un
  **stub** clairement marqué `{"stub": true, ...}` ; l'application ne plante jamais.

---

## 2. Stack technique

### Backend — `services/api`
- **FastAPI** (app créée dans `main.py`, lifespan asynchrone).
- **SQLAlchemy 2.0 async** (`Mapped` / `mapped_column`), driver **asyncpg**.
- **Pydantic v2** + **pydantic-settings** pour la configuration et les schémas.
- **PostgreSQL** comme base de données.
- **PyJWT** pour l'authentification (JWT maison).
- **SDK `anthropic`** (`AsyncAnthropic`) pour les appels LLM.
- **python-multipart** (uploads), **uvicorn[standard]** (serveur ASGI).

Dépendances exactes (`services/api/requirements.txt`) :
```
fastapi
uvicorn[standard]
sqlalchemy>=2.0
asyncpg
pydantic>=2
pydantic-settings
pyjwt
anthropic
python-multipart
```

### Frontend — `apps/web`
- **Next.js 14.2.5** (App Router), **React 18.3**, **TypeScript** strict.
- **Tailwind CSS 3.4** ; composants façon shadcn écrits à la main.
- **lucide-react** pour les icônes.
- **clsx** (helper `cn`).
- Polices via `next/font/google` : **Saira** (titres), **IBM Plex Sans** (texte),
  **IBM Plex Mono** (logs / IDs / versions).

### Modèle LLM (Claude)
- Client `AsyncAnthropic()` instancié **uniquement si `ANTHROPIC_API_KEY` est présente**
  (sinon `None` → mode stub).
- Modèle : `os.getenv("OPENCLAW_MODEL", "claude-opus-4-8")`.
- Appel unique : `messages.create(model, max_tokens=8192, system, messages)`.
  **Aucun** des paramètres interdits sur opus-4-8 n'est envoyé (pas de `temperature`,
  `top_p`, `top_k`, `budget_tokens`, ni bloc `thinking`).
- Vision : blocs `image` base64 (`media_type` déduit de l'extension) suivis d'un
  bloc `text`.
- Parsing JSON tolérant : retrait des fences ```` ```json ````, et repli sur
  `{"raw": text}` si le JSON est invalide.

---

## 3. Arborescence réelle

```
saas/
├── README.md
├── Makefile                      # raccourcis dev (db, api, web, seed)
├── docker-compose.yml            # Postgres 16 local
├── .env.example
├── .gitignore
│
├── design/
│   └── cockpit-dashboard.html    # source de vérité du design (portée en CSS/Tailwind)
│
├── docs/
│   └── ARCHITECTURE.md           # ce document
│
├── services/api/                 # ===== BACKEND FastAPI =====
│   ├── main.py                   # app FastAPI, CORS, lifespan (create_all + seed), routers, /health
│   ├── config.py                 # Settings (pydantic-settings), defaults dev-friendly
│   ├── database.py               # engine async, async_session_maker, Base, get_session
│   ├── deps.py                   # get_db (session async)
│   ├── models.py                 # 7 modèles ORM SQLAlchemy 2.0
│   ├── schemas.py                # schémas Pydantic v2 (Create/Read/Update par entité)
│   ├── enums.py                  # TaskStatus, RiskLevel, DocumentStatus, ApprovalStatus, CommandStatus
│   ├── seed.py                   # seeding idempotent (agents + données de démo)
│   ├── requirements.txt
│   ├── .env.example
│   ├── __init__.py
│   │
│   ├── core/
│   │   ├── security.py           # JWT: create_access_token, decode_token, authenticate, get_current_user
│   │   ├── command_router.py     # ORCHESTRATION: classify_intent + process_command
│   │   ├── risk_engine.py        # compute_risk + requires_human_validation
│   │   ├── approval_engine.py    # create_approval + apply_decision
│   │   └── audit_logger.py       # log_event (insert d'une ligne logs)
│   │
│   ├── agents/
│   │   ├── base.py               # BaseAgent (ABC): run / validate_input / get_metadata
│   │   ├── llm.py                # AsyncAnthropic, llm_available, complete_json, classify_intent_llm
│   │   ├── registry.py           # AgentRegistry + instance `registry` (4 agents enregistrés)
│   │   ├── photo_analysis_agent.py  # analyze_photo  → photo_report (risk low)
│   │   ├── quote_agent.py           # create_quote(_from_photo) → quote (risk medium, approval)
│   │   ├── site_report_agent.py     # create_site_report → site_report (risk low)
│   │   └── tender_agent.py          # analyze_tender → tender_response (risk medium, approval)
│   │
│   ├── routes/
│   │   ├── auth.py               # POST /auth/login, GET /auth/me
│   │   ├── openclaw.py           # POST /openclaw/command, GET /openclaw/commands[/{id}]
│   │   ├── projects.py           # GET/POST /projects, GET/PATCH /projects/{id}
│   │   ├── agents.py             # CRUD + /{id}/run, /{id}/enable, /{id}/disable
│   │   ├── tasks.py              # GET/POST /tasks, GET/PATCH /tasks/{id}
│   │   ├── approvals.py          # GET /approvals, POST /{id}/accept|reject
│   │   ├── documents.py          # GET/POST /documents, GET /documents/{id}
│   │   └── logs.py               # GET /logs, GET /logs/{project_id}
│   │
│   ├── mcp_gateway/              # SCAFFOLD non implémenté (passerelle outils externes)
│   │   ├── client.py             # MCPClient (placeholder)
│   │   ├── registry.py           # MCPRegistry (placeholder)
│   │   └── README.md
│   │
│   └── storage/files/.gitkeep    # stockage local des fichiers (dev)
│
└── apps/web/                     # ===== FRONTEND Next.js =====
    ├── package.json
    ├── next.config.js
    ├── tailwind.config.ts
    ├── tsconfig.json
    ├── postcss.config.js
    ├── middleware.ts             # ne bloque pas (auth réelle côté client)
    ├── .env.local.example
    │
    ├── app/
    │   ├── layout.tsx            # RootLayout: polices Saira/Plex Sans/Plex Mono
    │   ├── globals.css           # tokens design (variables CSS) + animations
    │   ├── page.tsx
    │   ├── (auth)/login/page.tsx
    │   └── (cockpit)/
    │       ├── layout.tsx        # garde d'auth client + grille Topbar/Sidebar/contenu
    │       ├── dashboard/page.tsx
    │       ├── openclaw/page.tsx
    │       ├── projects/page.tsx
    │       ├── projects/[id]/page.tsx
    │       ├── agents/page.tsx
    │       ├── agents/[id]/page.tsx
    │       ├── tasks/page.tsx
    │       ├── approvals/page.tsx
    │       ├── documents/page.tsx
    │       ├── logs/page.tsx
    │       └── settings/page.tsx
    │
    ├── components/
    │   ├── layout/{Sidebar,Topbar}.tsx
    │   └── ui/{RiskBadge,StatusChip,Panel,SectionHeader,Spinner}.tsx
    │
    └── lib/
        ├── api.ts                # client fetch typé (toutes les méthodes du contrat)
        ├── types.ts              # interfaces alignées sur Pydantic + enums
        ├── auth.ts               # get/set/clear token (localStorage)
        └── cn.ts                 # helper clsx
```

---

## 4. Flux d'orchestration détaillé

### 4.1 Intake d'une commande (`routes/openclaw.py`)

`POST /openclaw/command` :
1. Persiste la commande (`OpenClawCommand`) avec son statut par défaut `received`.
2. Planifie `core.command_router.process_command(command.id)` via les
   **`BackgroundTasks`** de FastAPI.
3. **Répond immédiatement** (201) avec la commande créée ; l'orchestration tourne
   hors du cycle requête/réponse.

### 4.2 Classification de l'intention (`classify_intent`)

Priorité (la première règle qui s'applique gagne) :
1. **Intention fournie** (`provided_intent`) si elle est dans la whitelist.
2. **LLM** (`classify_intent_llm`) si un client Anthropic est configuré.
3. **Heuristique mots-clés FR** (`_heuristic_intent`).
4. **Défaut** : `analyze_photo`.

Heuristique FR (ordre important) :
- `devis` + `photo` → `create_quote_from_photo`
- `devis` → `create_quote`
- `appel d'offre` / `ao` / `dce` → `analyze_tender`
- `compte-rendu` / `visite` → `create_site_report`
- `photo` → `analyze_photo`
- sinon → `analyze_photo`

### 4.3 Whitelist intention → agent (`INTENT_TO_AGENT`)

| Intention                 | Agent (slug)            |
|---------------------------|-------------------------|
| `analyze_photo`           | `photo_analysis_agent`  |
| `create_quote`            | `quote_agent`           |
| `create_quote_from_photo` | `quote_agent`           |
| `create_site_report`      | `site_report_agent`     |
| `analyze_tender`          | `tender_agent`          |

Toute intention **hors whitelist**, ou un **agent désactivé** (`enabled = False`),
ou un slug **introuvable** ⇒ la commande passe en `failed`, avec un log `command.failed`
de niveau `error`.

### 4.4 Cycle de vie complet (`process_command`)

`process_command` ouvre sa **propre session** (il tourne détaché) et **ne lève jamais**
d'exception : tout échec est inscrit sur la commande et dans les logs.

1. **`command.received`** — log d'entrée. `command.status = received`.
2. **Classification** — `command.status = routing`, intention résolue et stockée.
   Log **`command.routing`**.
3. **Résolution de l'agent** — whitelist + agent activé (rejet → `command.failed`).
4. **Création de la task** — `Task(status=running)`, `command.status = running`,
   `agent.status = "running"`. Log **`task.created`**.
5. **Exécution de l'agent** — `registry.get(slug).run(input)`. En cas d'exception :
   `task.status = failed`, `task.error = …`, `agent.status = "idle"`, puis
   `command.failed`. Sinon, `task.result = result` et log **`agent.run`**
   (le payload indique `stub: true/false`).
6. **Persistance du document** — si le résultat contient un `document_type`, un
   `Document(status=draft)` est créé et lié à la task. Log **`document.generated`**.
7. **Risque + validation** — `risk_engine.compute_risk(intent, document_type)` puis
   `requires_human_validation(...)`. `command.risk_level` est mis à jour.
   - **Validation requise** : `create_approval(...)` (log **`approval.requested`**,
     niveau `warning`), puis `task.status = waiting_approval`,
     `document.status = waiting_approval`, `command.status = waiting_approval`,
     `command.requires_approval = True`, `agent.status = "idle"`. **Le flux s'arrête là.**
   - **Pas de validation** : `task.status = completed` (+ `completed_at`),
     `command.status = completed`, `agent.status = "idle"`. Log **`command.completed`**.

### 4.5 Diagramme d'états

```
COMMANDE  : received → routing → running → (waiting_approval) → completed
                                        └────────────────────→ failed

TASK      : running → (waiting_approval) → completed
                   └─────────────────────→ failed
                                          └ (rejet validation) → cancelled

DOCUMENT  : draft → (waiting_approval) → approved
                                       └→ rejected            # via décision humaine

APPROVAL  : pending → accepted | rejected
```

### 4.6 Décision humaine (`core/approval_engine.py`, `routes/approvals.py`)

- `POST /approvals/{id}/accept` et `/reject` exigent un statut `pending` (sinon `409`).
- `apply_decision` :
  - **Accepté** : tous les documents liés à la task passent `approved` ; la task
    passe `completed` (+ `completed_at`).
  - **Refusé** : documents liés → `rejected` ; task → `cancelled`.
  - Renseigne `status`, `decision_by` (email de l'utilisateur), `decision_note`,
    `decided_at`, puis log **`approval.decided`**.

### 4.7 Run manuel d'un agent (`routes/agents.py`)

`POST /agents/{id}/run` permet de déclencher un agent **sans passer par OpenClaw**.
Il **réutilise la même machinerie** (risk engine, approvals, audit) :
- Rejet `400` si l'agent est désactivé ou si le slug n'est pas dans le registre.
- Crée une `Task(status=running)`, met `agent.status = "running"`, répond `202` avec
  la task, puis exécute `_run_agent_task` en `BackgroundTasks`.
- `_run_agent_task` reproduit le cycle : exécution → persistance document draft →
  calcul du risque → validation si nécessaire (`waiting_approval`) → `completed`.
  Logs : `task.created`, `agent.run`, `document.generated`, éventuellement
  `approval.requested`, puis `task.completed`.

### 4.8 Événements journalisés (`event_type`)

`command.received`, `command.routing`, `command.failed`, `command.completed`,
`task.created`, `task.completed`, `agent.run`, `agent.run_rejected`, `agent.created`,
`agent.updated`, `agent.enabled`, `agent.disabled`, `document.generated`,
`approval.requested`, `approval.decided`, `seed.project_created`, `seed.agents_registered`.

---

## 5. Moteur de risque (`core/risk_engine.py`)

`compute_risk(intent, document_type, action)` — le niveau le plus élevé l'emporte
(`blocked > high > medium > low`) :

| Niveau    | Déclencheurs (tels que codés)                                                       |
|-----------|-------------------------------------------------------------------------------------|
| `blocked` | action ∈ {`delete_database`, `expose_secrets`}                                      |
| `high`    | action ∈ {`send_to_client`, `delete`, `external_action`, `update_validated_data`}   |
| `medium`  | document_type ∈ {`quote`, `tender_response`, `site_report`, `document_update`} **ou** intent ∈ {`create_quote`, `create_quote_from_photo`, `create_site_report`, `analyze_tender`} |
| `low`     | intent ∈ {`analyze_photo`} ; défaut (analyse, brouillon, résumé)                    |

`requires_human_validation(risk, document_type, requires_approval, action)` ⇒ `True` si :
- `risk` ∈ {`high`, `blocked`}, **ou**
- `requires_approval` est vrai, **ou**
- `document_type` ∈ {`quote`, `tender_response`}, **ou**
- `action == "send_to_client"`, **ou**
- `risk == medium` **et** `document_type` est une sortie client ({`quote`, `tender_response`}).

> En pratique, dans le flux actuel : les devis et réponses AO déclenchent toujours
> une validation humaine ; l'analyse photo et le compte-rendu de chantier passent
> directement en `completed` (sauf si `requires_approval` est forcé sur la commande).

---

## 6. Sous-agents IA (`agents/`)

Tous héritent de `BaseAgent` (ABC) et exposent des attributs de classe
(`slug`, `name`, `role`, `description`, `version`, `risk_level`, `requires_approval`),
une méthode async `run(input_data) -> dict` et `get_metadata()`. Chaque agent appelle
`llm.complete_json(...)` avec un **system prompt métier en français**, et **retombe sur
un stub** `{"stub": true, ...}` en cas de `LLMUnavailable` ou de toute erreur. `run()`
renvoie toujours un dict.

| Agent                  | slug                   | Intentions               | document_type    | risk   | approval |
|------------------------|------------------------|--------------------------|------------------|--------|----------|
| Agent Analyse Photo    | `photo_analysis_agent` | `analyze_photo`          | `photo_report`   | low    | non      |
| Agent Devis            | `quote_agent`          | `create_quote(_from_photo)` | `quote`       | medium | oui      |
| Agent Compte-Rendu     | `site_report_agent`    | `create_site_report`     | `site_report`    | low    | non      |
| Agent Appels d'Offres  | `tender_agent`         | `analyze_tender`         | `tender_response`| medium | oui      |

Particularités :
- **Photo** : vision base64 (les fichiers illisibles sont ignorés). Si aucune image,
  l'agent s'appuie sur le contexte texte sans rien inventer.
- **Devis** : les totaux (`total_ht`, `total_tva` à 20 %, `total_ttc`) sont **recalculés
  côté serveur** ; les hypothèses sont rendues explicites.
- **AO** : extrait `pieces_demandees`, `criteres`, `delais`, `points_vigilance`.

Les agents intégrés sont enregistrés dans `registry` (`agents/registry.py`) et insérés
en base au premier démarrage par `seed.py` (`agent_type = "builtin"`).

---

## 7. Modèle de données (PostgreSQL)

7 tables (`services/api/models.py`). **Clé primaire UUID** (`default uuid4`).
Timestamps en `DateTime(timezone=True)` avec `server_default=func.now()` (et
`onupdate=func.now()` pour `updated_at`). Les colonnes JSON utilisent le type `JSON`.
Les enums sont **stockés en texte** (valeur `.value`), pas en type ENUM PostgreSQL.

### Schéma

```
┌──────────────────┐
│ projects         │  id, name, client_name, address, project_type,
│                  │  status(active), description, created_at, updated_at
└──────────────────┘
        ▲ ▲ ▲ ▲ (project_id, nullable)
        │ │ │ └────────────────────────────────────────┐
        │ │ └──────────────────────────────┐            │
        │ └──────────────┐                  │            │
        │                │                  │            │
┌───────┴──────────┐  ┌──┴───────────┐  ┌───┴────────┐  ┌┴─────────────┐
│ openclaw_commands│  │ tasks        │  │ approvals  │  │ documents    │
│ id, source,      │  │ id,          │  │ id,        │  │ id,          │
│ project_id?,     │◄─┤ command_id?, │◄─┤ command_id?│  │ project_id?, │
│ intent?,         │  │ project_id?, │  │ task_id?,  │◄─┤ task_id?,    │
│ instruction,     │  │ agent_id?,   │  │ project_id?│  │ document_type│
│ status(received),│  │ title,       │  │ title,     │  │ title,       │
│ risk_level(low), │  │ instruction, │  │ description│  │ file_path?,  │
│ requires_approval│  │ status,      │  │ status,    │  │ content?,    │
│ result?,         │  │ priority,    │  │ risk_level,│  │ status(draft)│
│ created/updated  │  │ result?,     │  │ payload,   │  │ created/upd  │
└──────────────────┘  │ error?,      │  │ decision_by│  └──────────────┘
                      │ created/upd, │  │ decision_  │
                      │ completed_at?│  │  note?,    │
                      └──────┬───────┘  │ created_at,│
                             │          │ decided_at?│
                             │          └────────────┘
                  ┌──────────┴─────────┐
                  │ agents             │
                  │ id, name,          │
                  │ slug(unique),      │
                  │ role, description, │
                  │ agent_type,        │
                  │ version(1.0.0),    │
                  │ status(idle),      │
                  │ enabled(true),     │
                  │ risk_level(low),   │
                  │ config, input_/    │
                  │ output_schema,     │
                  │ created/updated    │
                  └────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ logs (journal append-only)                                     │
│ id, project_id?, command_id?, task_id?, agent_id?,             │
│ level(info), event_type, message, payload, created_at          │
└──────────────────────────────────────────────────────────────┘
```

### Relations (clés étrangères, toutes nullable + indexées)
- `openclaw_commands.project_id` → `projects.id`
- `tasks.{project_id, command_id, agent_id}` → `projects / openclaw_commands / agents`
- `approvals.{project_id, command_id, task_id}` → `projects / openclaw_commands / tasks`
- `documents.{project_id, task_id}` → `projects / tasks`
- `logs.{project_id, command_id, task_id, agent_id}` → tables correspondantes

### Index
Index posés sur toutes les **FK**, sur les colonnes **`status`** (projects, commands,
agents, tasks, approvals, documents) et sur **`created_at`** de chaque table.
`agents.slug` est `UNIQUE` et indexé.

### Énumérations (`enums.py`, valeurs `str`)
- **TaskStatus** : `pending | assigned | running | waiting_approval | completed | failed | cancelled`
- **RiskLevel** : `low | medium | high | blocked`
- **DocumentStatus** : `draft | waiting_approval | approved | rejected | sent | archived`
- **ApprovalStatus** : `pending | accepted | rejected`
- **CommandStatus** : `received | routing | running | waiting_approval | completed | failed`

> Création du schéma : au démarrage, le `lifespan` de `main.py` exécute
> `Base.metadata.create_all` (via `run_sync`). **Il n'y a pas de migrations Alembic**
> dans la V1. Après création, `seed()` insère les 4 agents intégrés (si la table
> `agents` est vide), un projet de démo (« Chantier Villa Ducos »), quelques commandes
> de démo (statut `received`) et deux lignes de log.

---

## 8. Contrat API

Base : `http://localhost:8000`. **Toutes les routes exigent un JWT
(`get_current_user`) sauf `POST /auth/login` et `GET /health`.** Le jeton est passé en
en-tête `Authorization: Bearer <token>`.

### Auth
| Méthode | Chemin         | Description                                  |
|---------|----------------|----------------------------------------------|
| POST    | `/auth/login`  | `{email, password}` → `{access_token, token_type:"bearer"}` |
| GET     | `/auth/me`     | `{ "email": <sub> }`                         |

### OpenClaw
| Méthode | Chemin                     | Description                                          |
|---------|----------------------------|------------------------------------------------------|
| POST    | `/openclaw/command`        | `{source, instruction, project_id?, intent?}` ; répond 201 immédiatement, orchestration en tâche de fond |
| GET     | `/openclaw/commands`       | Liste (filtre `project_id?`, `limit`), plus récent d'abord |
| GET     | `/openclaw/commands/{id}`  | Détail (404 sinon)                                   |

### Projects
| Méthode | Chemin            | Description            |
|---------|-------------------|------------------------|
| GET     | `/projects`       | Liste                  |
| POST    | `/projects`       | Création               |
| GET     | `/projects/{id}`  | Détail                 |
| PATCH   | `/projects/{id}`  | Mise à jour partielle  |

### Agents
| Méthode | Chemin                  | Description                                            |
|---------|-------------------------|--------------------------------------------------------|
| GET     | `/agents`               | Liste                                                  |
| POST    | `/agents`               | Création (409 si slug déjà pris)                       |
| GET     | `/agents/{id}`          | Détail                                                 |
| PATCH   | `/agents/{id}`          | Mise à jour partielle                                  |
| POST    | `/agents/{id}/run`      | Run manuel (`{instruction?, project_id?}`) → 202 + task ; 400 si désactivé / non enregistré |
| POST    | `/agents/{id}/enable`   | `enabled = true`                                       |
| POST    | `/agents/{id}/disable`  | `enabled = false`                                      |

### Tasks
| Méthode | Chemin         | Description           |
|---------|----------------|-----------------------|
| GET     | `/tasks`       | Liste                 |
| POST    | `/tasks`       | Création              |
| GET     | `/tasks/{id}`  | Détail                |
| PATCH   | `/tasks/{id}`  | Mise à jour partielle |

### Approvals
| Méthode | Chemin                    | Description                              |
|---------|---------------------------|------------------------------------------|
| GET     | `/approvals`              | Liste (filtre `status?`)                 |
| POST    | `/approvals/{id}/accept`  | `{note?}` → accepte (409 si déjà tranché)|
| POST    | `/approvals/{id}/reject`  | `{note?}` → refuse (409 si déjà tranché) |

### Documents
| Méthode | Chemin             | Description                                          |
|---------|--------------------|------------------------------------------------------|
| GET     | `/documents`       | Liste (filtres `project_id?`, `status?`)             |
| POST    | `/documents`       | Création (statut **forcé** à `draft`)                |
| GET     | `/documents/{id}`  | Détail (404 sinon)                                   |

### Logs (lecture seule)
| Méthode | Chemin                | Description                                  |
|---------|-----------------------|----------------------------------------------|
| GET     | `/logs`               | Liste (filtres `level?`, `event_type?`, `limit`) |
| GET     | `/logs/{project_id}`  | Logs d'un projet (404 si projet inexistant)  |

### Santé
| Méthode | Chemin     | Description                                |
|---------|------------|--------------------------------------------|
| GET     | `/health`  | `{status:"ok", llm: <bool>}` (clé API présente ou non) |

> CORS : seules les requêtes depuis `settings.FRONTEND_ORIGIN`
> (`http://localhost:3000` par défaut) sont autorisées.

---

## 9. Frontend (`apps/web`)

### Structure App Router
- **Groupe `(auth)`** : `/login`.
- **Groupe `(cockpit)`** : layout 3 zones (Topbar + Sidebar + contenu), bordure
  supérieure ambre. **Garde d'auth côté client** : si pas de token en `localStorage`,
  redirection vers `/login` (le token n'est pas un cookie, donc le `middleware.ts`
  ne bloque rien et laisse passer ; il existe surtout pour fixer le matcher).
- 11 pages : `dashboard`, `openclaw`, `projects`, `projects/[id]`, `agents`,
  `agents/[id]`, `tasks`, `approvals`, `documents`, `logs`, `settings`.

### Couche API (`lib/api.ts`)
Client `fetch` typé. Base = `process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"`.
Attache `Authorization: Bearer <token>` (token lu via `lib/auth.ts` dans
`localStorage`, clé `openclaw_token`). Gestion d'erreurs centralisée (extraction du
`detail` FastAPI). Méthodes exposées : `login`, `me`, `sendCommand`, `listCommands`,
`getCommand`, `listProjects`, `getProject`, `createProject`, `updateProject`,
`listAgents`, `getAgent`, `updateAgent`, `runAgent`, `enableAgent`, `disableAgent`,
`listTasks`, `getTask`, `updateTask`, `listApprovals`, `acceptApproval`,
`rejectApproval`, `listDocuments`, `getDocument`, `listLogs`, `listProjectLogs`.

### Types (`lib/types.ts`)
Interfaces alignées sur les schémas Pydantic et les enums (`Project`, `OpenClawCommand`,
`Agent`, `Task`, `Approval`, `AppDocument`, `LogEntry`, `RiskLevel`, `TaskStatus`,
`DocumentStatus`, `ApprovalStatus`).

### Composants partagés
- `components/layout/` : `Sidebar` (navigation + bloc statut OpenClaw avec pulse
  « Opérationnel »), `Topbar`.
- `components/ui/` : `RiskBadge`, `StatusChip`, `Panel`, `SectionHeader`, `Spinner`.

### Design — source de vérité
`design/cockpit-dashboard.html`. Palette anthracite chaud + accent **ambre hi-vis**.
Couleurs de risque : **low = vert / medium = ambre / high = terracotta / blocked = rouge**.
Tokens portés en **variables CSS** dans `app/globals.css` (en `oklch`) et étendus dans
`tailwind.config.ts`. Polices via `next/font/google` : **Saira** (`--font-saira`),
**IBM Plex Sans** (`--font-plex-sans`), **IBM Plex Mono** (`--font-plex-mono`).
Animations (`oc-ring`, `oc-blink`, `oc-slide`, `oc-rise`) avec respect de
`prefers-reduced-motion`.

### Comportement temps réel
Les pages sont des **client components** (`"use client"`) qui chargent les vraies
données via `lib/api` (`useEffect`), gèrent les états loading/empty/error et
**pollent** (`setInterval` ~3s) les entités en cours (`running` / `waiting_approval`)
pour refléter l'avancement de l'orchestration asynchrone.

---

## 10. Authentification & sécurité

- **JWT maison** (`core/security.py`, PyJWT, HS256 par défaut). Compte **admin unique**
  défini par variables d'environnement (`ADMIN_EMAIL` / `ADMIN_PASSWORD`) — pas de
  table utilisateurs en V1.
- `POST /auth/login` valide les identifiants puis émet un JWT signé (`sub` = email,
  expiration `ACCESS_TOKEN_EXPIRE_MINUTES`, 720 min par défaut).
- `get_current_user` est la dépendance FastAPI qui décode le `Bearer` et renvoie
  `{"email": <sub>}` ; toute absence/erreur de jeton ⇒ `401`.
- Garde-fous V1 (rappel) : aucune suppression définitive, aucune action externe
  automatique, toute action sensible passe par une **validation humaine**, **tout est
  journalisé**, et les documents sont **toujours** créés en `draft`.

### Variables d'environnement (backend, `config.py`)
| Variable                      | Défaut (dev)                                              |
|-------------------------------|-----------------------------------------------------------|
| `DATABASE_URL`                | `postgresql+asyncpg://openclaw:openclaw@localhost:5432/openclaw` |
| `JWT_SECRET`                  | `dev-secret-change-me`                                    |
| `JWT_ALGORITHM`               | `HS256`                                                   |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `720`                                                     |
| `ADMIN_EMAIL`                 | `admin@btp.local`                                         |
| `ADMIN_PASSWORD`              | `changeme`                                                |
| `FRONTEND_ORIGIN`             | `http://localhost:3000`                                   |
| `ANTHROPIC_API_KEY`           | `""` (vide ⇒ agents en mode stub)                         |
| `OPENCLAW_MODEL`              | `claude-opus-4-8`                                         |

### Variable d'environnement (frontend)
| Variable               | Défaut                  |
|------------------------|-------------------------|
| `NEXT_PUBLIC_API_URL`  | `http://localhost:8000` |

---

## 11. MCP Gateway (scaffold, non implémenté)

`services/api/mcp_gateway/` est un **squelette** documenté dans son `README.md`. Il
n'est **pas branché** dans le flux actuel. La chaîne d'appel cible (règle) est :

```
OpenClaw → Backend (FastAPI) → Agent / Skill → MCP Gateway → Outil externe
```

`MCPClient` (`client.py`) et `MCPRegistry` (`registry.py`) sont des placeholders dont
les méthodes lèvent `NotImplementedError`. Toute action externe future restera soumise
aux mêmes règles : évaluation du risque, validation humaine si nécessaire,
journalisation complète.

---

## 12. Développement local

Le projet tourne **100 % en local** en V1. `docker-compose.yml` ne fournit que
**PostgreSQL 16** (`db`, port 5432, identifiants `openclaw`/`openclaw`/`openclaw`,
volume `pgdata`, healthcheck `pg_isready`). Le backend et le frontend se lancent
directement (hors conteneur).

Raccourcis (`Makefile`) :
```
make db        # docker compose up -d db        (PostgreSQL détaché)
make db-down   # docker compose down
make api       # cd services/api && uvicorn main:app --reload --port 8000
make web       # cd apps/web && npm run dev      (port 3000)
make seed      # cd services/api && python seed.py
```

Au premier démarrage de l'API, le `lifespan` crée les tables puis seed les agents et
les données de démo (idempotent : sans effet si la table `agents` contient déjà des
lignes). `make seed` permet d'exécuter le seeding manuellement.

---

## 13. Déploiement (cible)

> Cibles de déploiement standard de la stack. Le dépôt ne contient pas de
> configuration de déploiement dédiée (Dockerfile prod, fichiers Vercel/Railway,
> migrations Alembic) : ces éléments sont à ajouter le moment venu.

- **Frontend (`apps/web`)** → **Vercel** (Next.js 14 App Router). Variable d'env de
  production : `NEXT_PUBLIC_API_URL` pointant vers l'URL publique du backend.
- **Backend (`services/api`)** → **Railway** (service FastAPI / uvicorn). Variables
  d'env requises en prod : `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`,
  `ADMIN_PASSWORD`, `FRONTEND_ORIGIN` (origine Vercel), `ANTHROPIC_API_KEY`,
  `OPENCLAW_MODEL`.
- **Base de données** → **Supabase** (PostgreSQL managé) ou Postgres Railway. Le code
  étant agnostique du provider (asyncpg), il suffit de fournir le `DATABASE_URL`
  correspondant (`postgresql+asyncpg://…`).
- **CORS** : `FRONTEND_ORIGIN` doit être réglé sur l'origine du frontend déployé.
- **Stockage de fichiers** : `services/api/storage/files` en local (dev) ; à remplacer
  par un stockage objet (ex. Supabase Storage) en production si nécessaire.

### Points de vigilance pour la production
- Définir un `JWT_SECRET` fort et des identifiants admin réels (ne pas laisser les
  défauts dev).
- `Base.metadata.create_all` crée les tables manquantes mais **ne gère pas les
  migrations** : prévoir Alembic pour faire évoluer le schéma.
- `process_command` et `_run_agent_task` s'appuient sur les `BackgroundTasks` de
  FastAPI (in-process) : suffisant en V1, mais une file de tâches dédiée serait
  nécessaire pour une charge élevée ou plusieurs instances.

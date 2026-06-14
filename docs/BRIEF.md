# BRIEF — BTP OpenClaw Cockpit

> Document de cadrage produit. À jour avec le code réellement implémenté
> (`services/api` et `apps/web`). Aucune fonctionnalité non implémentée n'est décrite ici.

---

## 1. Résumé du produit

**BTP OpenClaw Cockpit** est un SaaS interne : un cockpit de pilotage pour le BTP,
commandé par **OpenClaw**, l'agent maître.

OpenClaw ne fait qu'**émettre des instructions en langage naturel**. C'est le
**backend FastAPI qui est l'autorité** : il reçoit la commande, classe l'intention,
choisit un sous-agent métier via une **whitelist**, crée une tâche, exécute l'agent
(Claude via le SDK `anthropic`), produit des documents **toujours en brouillon**,
ouvre une **validation humaine** pour les actions sensibles, et **journalise chaque étape**.

OpenClaw **n'écrit jamais directement** en base de données ni dans les fichiers, et
n'appelle jamais d'outil externe en direct.

Principe central : la chaîne d'exécution traverse toujours le backend, qui applique
le contrôle de risque et la traçabilité.

```
OpenClaw  ->  Backend (FastAPI, autorité)  ->  Sous-agent (Claude)  ->  Document (brouillon)
                                                      |
                                                      v
                                          Risk engine + validation humaine + audit log
```

---

## 2. Objectifs

- **Centraliser** le pilotage d'opérations BTP (chantiers / affaires) derrière une
  seule surface de commande.
- **Déléguer le travail métier** à des sous-agents IA spécialisés (analyse photo,
  devis, compte-rendu de chantier, appel d'offres), encadrés par le backend.
- **Garder l'humain dans la boucle** : toute production à enjeu (devis, réponse AO,
  sortie client, action à risque élevé) passe par une validation explicite avant
  d'être considérée comme finalisée.
- **Tout tracer** : chaque commande, routage, tâche, exécution d'agent, document
  généré et décision est consigné dans un journal append-only.
- **Rester fonctionnel sans clé LLM** : sans `ANTHROPIC_API_KEY`, les agents
  renvoient des résultats **stub** clairement marqués (`{"stub": true, ...}`) au bon
  format ; l'application ne crashe jamais et reste utilisable de bout en bout.
- **Tourner en local** simplement : Postgres via Docker Compose, backend FastAPI,
  frontend Next.js.

---

## 3. Périmètre V1 (implémenté)

### 3.1 Modèle de données — 7 tables

Source : `services/api/models.py`, `services/api/enums.py`.

| Table | Rôle |
| --- | --- |
| `projects` | Chantiers / affaires BTP. |
| `openclaw_commands` | Instructions brutes reçues d'OpenClaw. |
| `agents` | Registre des sous-agents disponibles (slug unique, `enabled`, `status`, `risk_level`). |
| `tasks` | Unités de travail créées par l'orchestrateur. |
| `approvals` | Validations humaines des actions sensibles. |
| `documents` | Artefacts générés, **toujours créés en `draft`**. |
| `logs` | Journal d'audit append-only. |

Conventions communes : PK `UUID` (`uuid4`), timestamps `DateTime(timezone=True)`
avec `server_default=func.now()`, index sur les FK + `status` + `created_at`.
Les colonnes typées par enum sont stockées en texte simple (la `.value` de l'enum).

**Enums (str)** :
- `TaskStatus` : `pending | assigned | running | waiting_approval | completed | failed | cancelled`
- `RiskLevel` : `low | medium | high | blocked`
- `DocumentStatus` : `draft | waiting_approval | approved | rejected | sent | archived`
- `ApprovalStatus` : `pending | accepted | rejected`
- `CommandStatus` : `received | routing | running | waiting_approval | completed | failed`

### 3.2 Orchestration d'une commande OpenClaw

Source : `services/api/core/command_router.py`.

La route `POST /openclaw/command` persiste la commande (`status = received`) puis
planifie `process_command(command_id)` via `BackgroundTasks` et **répond
immédiatement**. L'orchestration détachée enchaîne :

1. **`command.received`** — journalisation de la réception.
2. **Classification de l'intention** (`status = routing`), par ordre de priorité :
   - intention fournie si elle est dans la whitelist ;
   - sinon classifieur LLM (`classify_intent_llm`) si une clé est configurée ;
   - sinon **heuristique mots-clés FR** (devis → `create_quote` / `create_quote_from_photo`,
     appel d'offre / AO / DCE → `analyze_tender`, compte-rendu / visite → `create_site_report`,
     photo → `analyze_photo`) ;
   - défaut : `analyze_photo`.
   Journal : **`command.routing`**.
3. **Résolution de l'agent** via la whitelist `INTENT_TO_AGENT`. La commande est
   **rejetée** (`command.status = failed`, log `error`) si l'intention est hors
   whitelist, l'agent introuvable, ou l'agent **désactivé**.
4. **Création de la tâche** (`status = running`), passage `command.status = running`
   et `agent.status = "running"`. Journal : **`task.created`**.
5. **Exécution de l'agent** (`registry.get(slug).run(input)`). En cas d'exception,
   `task.status = failed` (+ `error`) et la commande échoue proprement.
   Journal : **`agent.run`** (avec drapeau `stub`).
6. **Persistance du document** en `draft` si l'agent retourne un `document_type`.
   Journal : **`document.generated`**.
7. **Évaluation du risque** (`risk_engine.compute_risk`) puis test de validation
   (`risk_engine.requires_human_validation`).
   - Si validation requise : création d'une **`approval`** (log **`approval.requested`**),
     `task.status = waiting_approval`, `document.status = waiting_approval`,
     `command.status = waiting_approval`, `command.requires_approval = true`.
   - Sinon : `task.status = completed` (+ `completed_at`), `command.status = completed`.
     Journal : **`command.completed`**.

Whitelist effective (`INTENT_TO_AGENT`) :

| Intention | Sous-agent (slug) |
| --- | --- |
| `analyze_photo` | `photo_analysis_agent` |
| `create_quote` | `quote_agent` |
| `create_quote_from_photo` | `quote_agent` |
| `create_site_report` | `site_report_agent` |
| `analyze_tender` | `tender_agent` |

### 3.3 Moteur de risque

Source : `services/api/core/risk_engine.py`.

`compute_risk(intent, document_type, action)` — le palier le plus élevé l'emporte
(`blocked > high > medium > low`) :
- **blocked** : actions `delete_database`, `expose_secrets`.
- **high** : actions `send_to_client`, `delete`, `external_action`, `update_validated_data`.
- **medium** : `document_type` ∈ {`quote`, `tender_response`, `site_report`, `document_update`},
  ou intention ∈ {`create_quote`, `create_quote_from_photo`, `create_site_report`, `analyze_tender`}.
- **low** : `analyze_photo` et, par défaut, toute analyse / brouillon / résumé.

`requires_human_validation(risk, document_type, requires_approval, action)` renvoie
`True` si :
- le risque est `high` ou `blocked` ; **ou**
- `requires_approval` est explicitement demandé ; **ou**
- `document_type` ∈ {`quote`, `tender_response`} ; **ou**
- `action == "send_to_client"` ; **ou**
- risque `medium` **et** sortie client (`document_type` ∈ {`quote`, `tender_response`}).

### 3.4 Sous-agents IA

Sources : `services/api/agents/` (`base.py`, `llm.py`, `registry.py`, + 4 agents).

- **`base.py`** — `BaseAgent` (ABC) : attributs de classe (`slug`, `name`, `role`,
  `description`, `version`, `risk_level`, `requires_approval`), `run(input_data) -> dict`,
  `validate_input` (permissif), `get_metadata()`.
- **`llm.py`** — couche d'accès Claude :
  - `MODEL = os.getenv("OPENCLAW_MODEL", "claude-opus-4-8")`, client `AsyncAnthropic()`
    (vaut `None` sans clé). `llm_available()`.
  - `complete_json(system, user, images=None, max_tokens=8192)` : construit les
    messages, appelle `messages.create` **sans aucun paramètre interdit**
    (pas de `temperature`, `top_p`, `top_k`, `budget_tokens`, ni bloc `thinking`),
    nettoie d'éventuelles fences ```` ```json ````, parse en JSON (tolérant :
    `{"raw": text}` à défaut). Vision : blocs image base64 avant le bloc texte.
  - `classify_intent_llm(instruction, allowed)`. Exception `LLMUnavailable` sans client.
- **`registry.py`** — `AgentRegistry` (`register` / `get` / `list`) + instance
  `registry` enregistrant les 4 agents.
- **Les 4 agents** appellent `complete_json` avec un *system prompt* métier en
  français et, en cas de `LLMUnavailable` ou d'erreur, renvoient un **stub** cohérent.
  Chacun retourne un dict avec au minimum `{document_type, title, status: "draft", content}`
  (sauf l'agent photo, dont la sortie reste un `photo_report` mais peut être un
  rapport d'observations plutôt qu'un document client).

| Agent | Slug | Intention(s) | `document_type` | `risk_level` | `requires_approval` |
| --- | --- | --- | --- | --- | --- |
| Agent Analyse Photo | `photo_analysis_agent` | `analyze_photo` | `photo_report` | `low` | `false` |
| Agent Devis | `quote_agent` | `create_quote`, `create_quote_from_photo` | `quote` | `medium` | `true` |
| Agent Compte-Rendu de Chantier | `site_report_agent` | `create_site_report` | `site_report` | `low` | `false` |
| Agent Appels d'Offres | `tender_agent` | `analyze_tender` | `tender_response` | `medium` | `true` |

Détails utiles : l'agent devis **recalcule toujours les totaux côté serveur**
(`total_ht`, TVA 20 %, `total_ttc`) ; l'agent AO extrait pièces demandées, critères,
délais et points de vigilance. Tous restituent leurs **hypothèses** quand une
information manque, sans rien inventer.

### 3.5 Validation humaine (human-in-the-loop)

Source : `services/api/core/approval_engine.py`, `services/api/routes/approvals.py`.

- `create_approval(...)` crée une `approval` en `pending` et journalise
  **`approval.requested`** (niveau `warning`).
- `POST /approvals/{id}/accept` / `POST /approvals/{id}/reject` (note optionnelle)
  appellent `apply_decision`, qui propage la décision aux entités liées :
  - **acceptée** → documents liés `approved`, tâche liée `completed` ;
  - **refusée** → documents liés `rejected`, tâche liée `cancelled`.
  - L'approval est horodatée (`decided_at`) et estampillée (`decision_by` =
    email du décideur authentifié, `decision_note`). Journal : **`approval.decided`**.
- Une approval déjà tranchée renvoie `409`.

### 3.6 Authentification

Source : `services/api/core/security.py`, `services/api/routes/auth.py`, `config.py`.

- JWT maison (`PyJWT`, HS256). Compte **admin unique** issu des variables d'env
  (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, défauts dev `admin@btp.local` / `changeme`).
- `POST /auth/login` → `{access_token, token_type: "bearer"}` ; `GET /auth/me` →
  `{"email": ...}`.
- `get_current_user` (dépendance FastAPI) décode le bearer ; **toutes les routes
  sauf `/auth/login` et `/health` l'exigent**.

### 3.7 Contrat API (chemins réellement exposés)

Sources : `services/api/routes/*.py`, `services/api/main.py`.

- `POST /auth/login` · `GET /auth/me`
- `POST /openclaw/command` · `GET /openclaw/commands` · `GET /openclaw/commands/{id}`
- `GET|POST /projects` · `GET|PATCH /projects/{id}`
- `GET|POST /agents` · `GET|PATCH /agents/{id}` · `POST /agents/{id}/run` ·
  `POST /agents/{id}/enable` · `POST /agents/{id}/disable`
- `GET|POST /tasks` · `GET|PATCH /tasks/{id}`
- `GET /approvals` · `POST /approvals/{id}/accept` · `POST /approvals/{id}/reject`
- `GET|POST /documents` · `GET /documents/{id}`
- `GET /logs` · `GET /logs/{project_id}`
- `GET /health` → `{status: "ok", llm: llm_available()}`

Note : `POST /agents/{id}/run` permet un **run manuel** (sans commande OpenClaw).
Il réutilise exactement la même machinerie risque / validation / audit que
l'orchestration des commandes (création de tâche `running`, exécution détachée,
document en brouillon, gate de validation, journalisation).

### 3.8 Frontend (cockpit)

Sources : `apps/web/` (`lib/api.ts`, `lib/types.ts`, `components/`, `app/`).

- **Next.js 14** (App Router), **TypeScript**, **Tailwind**, icônes `lucide-react`.
  Design porté depuis `design/cockpit-dashboard.html` (anthracite chaud + accent
  ambre, couleurs de risque, polices Saira / IBM Plex Sans / IBM Plex Mono).
- **`lib/api.ts`** : client `fetch` typé, base `NEXT_PUBLIC_API_URL`
  (défaut `http://localhost:8000`), attache `Authorization: Bearer <token>`
  (token en `localStorage`). Méthodes alignées 1:1 sur le contrat API.
- **`lib/types.ts`** : interfaces alignées sur les schémas Pydantic + enums
  (`Project`, `OpenClawCommand`, `Agent`, `Task`, `Approval`, `AppDocument`,
  `LogEntry`, `RiskLevel`, `TaskStatus`, `DocumentStatus`, `ApprovalStatus`, ...).
- **Composants partagés** : `components/layout/{Sidebar, Topbar}`,
  `components/ui/{RiskBadge, StatusChip, Panel, SectionHeader, Spinner}`.
- **Pages** (groupe `(cockpit)` + groupe `(auth)`) : Dashboard, Centre OpenClaw,
  Projets (+ détail), Sous-agents (+ détail), Tâches, Validations, Documents, Logs,
  Paramètres, Login. Les pages sont des *client components* qui chargent les vraies
  données via `lib/api`, gèrent loading / empty / error et **pollent** (`setInterval`)
  les éléments en cours (`running` / `waiting_approval`).

### 3.9 Infrastructure locale & démarrage

Sources : `docker-compose.yml`, `README.md`, `Makefile`, `config.py`.

- **Postgres 16** via Docker Compose (`localhost:5432`, user/pwd/db = `openclaw`).
- Au démarrage, le **lifespan** FastAPI crée les tables (`Base.metadata.create_all`)
  puis **seed** les 4 agents + données de démo (un projet "Chantier Villa Ducos",
  quelques commandes, deux lignes de log) **uniquement si la table `agents` est vide**
  (idempotent — voir `seed.py`).
- CORS autorise `settings.FRONTEND_ORIGIN` (défaut `http://localhost:3000`).
- Fichiers (dev) : stockage local `services/api/storage/files`.

---

## 4. Principes directeurs

### OpenClaw est le maître ; le backend est l'autorité
OpenClaw **commande** mais **n'exécute pas** : il soumet une instruction et c'est tout.
Le backend décide de l'intention, de l'agent, du risque, de la nécessité d'une
validation, et de ce qui est journalisé. OpenClaw n'a aucun accès direct en
écriture (base, fichiers, outils externes).

### Validation humaine pour les actions sensibles
Aucune sortie à enjeu n'est finalisée par l'IA seule. Devis, réponses AO,
sorties client et actions à risque élevé sont mis en pause sous forme d'`approval`
en attente, et seul un opérateur humain les accepte ou les refuse.

### Sécurité V1 : tout en brouillon, rien de définitif, tout tracé
- **Documents toujours créés en `draft`** ; ils ne deviennent `approved` / `sent`
  qu'après décision humaine.
- **Aucune suppression définitive** (statuts / soft), **aucune action externe
  automatique**.
- Actions `delete_database` / `expose_secrets` classées **`blocked`**.
- **Journalisation systématique** de chaque étape (audit append-only).

### Résilience sans LLM
Sans `ANTHROPIC_API_KEY`, le client Claude vaut `None` et chaque agent renvoie un
**stub** au format attendu (`{"stub": true, ...}`). L'application reste pleinement
fonctionnelle ; on ne crashe jamais sur l'absence de clé.

### Contraintes strictes du modèle `claude-opus-4-8`
Les appels n'envoient **que** `model`, `max_tokens`, `system` et `messages`.
Aucun paramètre interdit (`temperature`, `top_p`, `top_k`, `budget_tokens`, bloc
`thinking`) n'est jamais transmis.

### Simplicité d'abord
Code en anglais, UI et textes métier en français. Backend 100 % async
(SQLAlchemy 2.0, Pydantic v2). Périmètre minimal et non spéculatif : la
`mcp_gateway/` n'est qu'un **scaffold** (passerelle MCP non implémentée, prévue
pour passer plus tard par le risk engine et l'audit logger).

---

## 5. Hors périmètre V1 (non implémenté)

- **Passerelle MCP** réelle vers des outils externes (`services/api/mcp_gateway/`
  ne contient que des squelettes — voir son `README.md`).
- **Gestion multi-utilisateurs** : V1 = compte admin unique via variables d'env
  (pas de table `users`).
- **Envoi réel au client** et toute action externe automatisée (classés à risque
  et, par conception, jamais exécutés automatiquement en V1).
- **Suppression définitive** de données (uniquement statuts / soft).
</content>
</invoke>

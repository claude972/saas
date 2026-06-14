# API — BTP OpenClaw Cockpit

Documentation de l'API HTTP du backend FastAPI (`services/api`).
Rédigée à partir du **code réellement écrit** (routes, schémas Pydantic v2, modèles SQLAlchemy, moteur de risque / d'approbation, orchestrateur de commandes). Aucune fonctionnalité non implémentée n'est documentée.

- **Base URL (dev)** : `http://localhost:8000`
- **Titre de l'app** : `BTP OpenClaw Cockpit API`
- **Format** : JSON (`Content-Type: application/json`)
- **Authentification** : JWT Bearer (voir [Authentification](#authentification))
- **CORS** : seule l'origine `settings.FRONTEND_ORIGIN` est autorisée (défaut `http://localhost:3000`), `allow_credentials=true`, toutes méthodes et tous en-têtes.

> **Principe d'autorité backend.** OpenClaw n'écrit jamais directement en base ni sur le disque. Il soumet une instruction via `POST /openclaw/command` ; le backend classe l'intention, choisit un agent via une whitelist, crée une tâche, exécute l'agent, génère d'éventuels documents (toujours en `draft`), crée des validations humaines pour les actions sensibles, et journalise chaque étape.

---

## ⚠️ Avertissement d'état du code

Au moment de la rédaction, **le fichier `services/api/routes/tasks.py` est absent du dépôt** alors que :

- `main.py` l'importe : `from routes.tasks import router as tasks_router` puis `app.include_router(tasks_router, prefix="/tasks", ...)`.
- Le contrat d'API prévoit les routes `/tasks` et `/tasks/{id}`.
- Le client frontend (`apps/web/lib/api.ts`) appelle `GET /tasks`, `GET /tasks/{id}`, `PATCH /tasks/{id}`.

**Conséquence : en l'état, l'import échoue et le backend ne démarre pas tant que `routes/tasks.py` n'a pas été créé.** La section [Tâches (`/tasks`)](#tâches-tasks) ci-dessous documente le contrat attendu (chemins, payloads d'après le schéma Pydantic `TaskCreate`/`TaskUpdate`/`TaskRead` et l'usage frontend), et non un fichier de route existant.

Tous les autres routeurs (`auth`, `openclaw`, `projects`, `agents`, `approvals`, `documents`, `logs`) sont implémentés et présents.

---

## Authentification

L'authentification V1 repose sur **un compte admin unique** dont les identifiants viennent de l'environnement (`ADMIN_EMAIL` / `ADMIN_PASSWORD`). Il n'y a pas de table utilisateur.

- `POST /auth/login` valide les identifiants et renvoie un JWT signé (HS256).
- Toutes les routes **sauf `POST /auth/login` et `GET /health`** exigent un en-tête `Authorization: Bearer <token>`.
- Le token est décodé par la dépendance `get_current_user` (dans `core/security.py`). En cas de header manquant, malformé, ou token invalide/expiré → **401 Unauthorized** avec `WWW-Authenticate: Bearer` et `detail = "Identifiants invalides ou jeton expire."`.
- Claims du JWT : `sub` (= email admin), `iat`, `exp`. Expiration = `ACCESS_TOKEN_EXPIRE_MINUTES` minutes (défaut **720**, soit 12 h).
- `get_current_user` renvoie `{"email": <sub>}`.

En-tête à joindre sur toutes les routes protégées :

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Codes de statut & format d'erreur

Codes effectivement émis par le code :

| Code | Signification | Où |
|------|---------------|----|
| `200 OK` | Succès (GET, PATCH, login, accept/reject, enable/disable) | partout |
| `201 Created` | Création réussie | `POST /openclaw/command`, `POST /projects`, `POST /agents`, `POST /documents` |
| `202 Accepted` | Exécution lancée en arrière-plan | `POST /agents/{id}/run` |
| `400 Bad Request` | Run d'agent désactivé ou agent non enregistré dans le registre mémoire | `POST /agents/{id}/run` |
| `401 Unauthorized` | Identifiants invalides ou jeton manquant/expiré | `POST /auth/login`, toute route protégée |
| `404 Not Found` | Ressource introuvable | tous les `GET/PATCH /{id}` |
| `409 Conflict` | Slug d'agent déjà existant ; validation déjà tranchée | `POST /agents`, `POST /approvals/{id}/accept|reject` |
| `422 Unprocessable Entity` | Corps/paramètres invalides (validation Pydantic/FastAPI) | tout endpoint à payload |

Format d'erreur (FastAPI standard) :

```json
{ "detail": "Message d'erreur en français." }
```

Pour les erreurs de validation (422), `detail` est une **liste** d'objets `{ "loc", "msg", "type" }`.

> Le client frontend (`extractError`) lit `detail` si c'est une chaîne, sinon le `msg` du premier élément de la liste, sinon retombe sur `Erreur <status> <statusText>`.

---

## Conventions de listing

- Les listes sont triées **du plus récent au plus ancien** (`created_at DESC`).
- `GET /openclaw/commands` accepte `limit` (1–200, défaut 50) et `project_id`.
- `GET /logs` et `GET /logs/{project_id}` acceptent `limit` (1–1000, défaut 100), `level`, `event_type`.
- `GET /documents` accepte `project_id` et `status`.
- Plusieurs routes acceptent la variante avec et sans slash final (`""` et `"/"`) : `documents`, `logs`. Les routes `agents` sont déclarées **avec** slash final (`/agents/`) ; FastAPI émet une redirection 307 de `/agents` vers `/agents/`. Les routes `projects` et `openclaw` sont déclarées **sans** slash final.

---

## Endpoints

### Santé

#### `GET /health`
Public (pas d'auth).

**Réponse 200**
```json
{ "status": "ok", "llm": true }
```
`llm` = `true` si une clé `ANTHROPIC_API_KEY` est configurée (client Anthropic disponible), sinon `false` (les agents renvoient des stubs).

---

### Auth (`/auth`)

#### `POST /auth/login`
Public.

**Corps**
```json
{ "email": "admin@btp.local", "password": "changeme" }
```
- `email` : `EmailStr` (validé).
- `password` : string.

**Réponse 200**
```json
{ "access_token": "<jwt>", "token_type": "bearer" }
```

**Erreurs** : `401` si les identifiants ne correspondent pas au compte admin (`detail = "Identifiants invalides."`). `422` si l'email est mal formé.

#### `GET /auth/me`
Protégé.

**Réponse 200**
```json
{ "email": "admin@btp.local" }
```

---

### OpenClaw (`/openclaw`)

Surface unique par laquelle OpenClaw (agent maître) parle au cockpit.

#### `POST /openclaw/command`
Protégé. Persiste la commande (statut initial `received`) puis **planifie l'orchestration en arrière-plan** (`BackgroundTasks` → `process_command`). Réponse immédiate.

**Corps** (`OpenClawCommandCreate`)
```json
{
  "source": "openclaw",
  "instruction": "Fais-moi un devis à partir de cette photo de fissure.",
  "project_id": "uuid-optionnel",
  "intent": "create_quote_from_photo"
}
```
- `source` : string, défaut `"openclaw"`.
- `instruction` : string, **requis**.
- `project_id` : UUID, optionnel.
- `intent` : string, optionnel (voir [whitelist d'intentions](#orchestration-des-commandes)).

**Réponse 201** (`OpenClawCommandRead`) — la commande créée, avec son statut `received` (l'orchestration se fait ensuite de façon asynchrone) :
```json
{
  "id": "uuid",
  "source": "openclaw",
  "project_id": null,
  "intent": "create_quote_from_photo",
  "instruction": "Fais-moi un devis...",
  "status": "received",
  "risk_level": "low",
  "requires_approval": false,
  "result": null,
  "created_at": "2026-06-14T10:00:00Z",
  "updated_at": "2026-06-14T10:00:00Z"
}
```

#### `GET /openclaw/commands`
Protégé. Liste des commandes, plus récentes d'abord.

**Query** : `project_id` (UUID, optionnel), `limit` (int 1–200, défaut 50).

**Réponse 200** : `OpenClawCommandRead[]`.

#### `GET /openclaw/commands/{command_id}`
Protégé.

**Réponse 200** : `OpenClawCommandRead`. **404** si introuvable (`detail = "Commande OpenClaw introuvable."`).

---

### Projets (`/projects`)

CRUD **sans suppression** (V1 : changements de statut uniquement). Création et mise à jour journalisées (`project.created`, `project.updated`).

#### `GET /projects`
Protégé. Tous les projets, plus récents d'abord. → `ProjectRead[]`.

#### `POST /projects`
Protégé.

**Corps** (`ProjectCreate`)
```json
{
  "name": "Rénovation toiture Dupont",
  "client_name": "M. Dupont",
  "address": "12 rue des Lilas, Lyon",
  "project_type": "renovation",
  "status": "active",
  "description": "Reprise complète de la couverture."
}
```
- `name` : string, **requis**.
- `client_name`, `address`, `project_type`, `description` : optionnels (nullable).
- `status` : string, défaut `"active"`.

**Réponse 201** : `ProjectRead`.

#### `GET /projects/{project_id}`
Protégé. → `ProjectRead`. **404** si introuvable (`detail = "Projet introuvable."`).

#### `PATCH /projects/{project_id}`
Protégé. Mise à jour partielle (seuls les champs fournis sont écrits — `exclude_unset`).

**Corps** (`ProjectUpdate`, tous optionnels) : `name`, `client_name`, `address`, `project_type`, `status`, `description`.

**Réponse 200** : `ProjectRead`. **404** si introuvable.

---

### Agents (`/agents`)

CRUD sur la table `agents` + endpoints opérationnels. Routes déclarées avec slash final (`/agents/`).

> **Note** : le frontend appelle `GET /agents` et `POST /agents` (sans slash). FastAPI répond par une redirection **307** vers `/agents/`.

#### `GET /agents/`
Protégé. Tous les agents, plus récents d'abord. → `AgentRead[]`.

#### `POST /agents/`
Protégé. Crée une ligne d'agent. Journalise `agent.created`.

**Corps** (`AgentCreate`)
```json
{
  "name": "Analyse photo chantier",
  "slug": "photo_analysis_agent",
  "role": "Analyste visuel",
  "description": "Analyse les photos de chantier.",
  "agent_type": "vision",
  "version": "1.0.0",
  "status": "idle",
  "enabled": true,
  "risk_level": "low",
  "config": null,
  "input_schema": null,
  "output_schema": null
}
```
- `name` : string, **requis**. `slug` : string, **requis** et **unique**.
- `version` : défaut `"1.0.0"`. `status` : défaut `"idle"`. `enabled` : défaut `true`. `risk_level` : défaut `"low"`.
- `role`, `description`, `agent_type`, `config`, `input_schema`, `output_schema` : optionnels.

**Réponse 201** : `AgentRead`. **409** si le `slug` existe déjà (`detail = "Un agent avec le slug '...' existe deja."`).

#### `GET /agents/{agent_id}`
Protégé. → `AgentRead`. **404** si introuvable (`detail = "Agent introuvable."`).

#### `PATCH /agents/{agent_id}`
Protégé. Mise à jour partielle (`exclude_unset`). Journalise `agent.updated`.

**Corps** (`AgentUpdate`, tous optionnels) : `name`, `role`, `description`, `agent_type`, `version`, `status`, `enabled`, `risk_level`, `config`, `input_schema`, `output_schema`.

**Réponse 200** : `AgentRead`.

#### `POST /agents/{agent_id}/run`
Protégé. Lance un **run manuel** (sans commande OpenClaw) : crée une tâche `running` et l'exécute en arrière-plan (`BackgroundTasks` → `_run_agent_task`), en réutilisant la même mécanique risque/approbation/audit que l'orchestrateur.

**Corps** (`AgentRunRequest`, optionnel — peut être omis ou `{}`)
```json
{ "instruction": "Analyse cette photo de façade.", "project_id": "uuid-optionnel" }
```
- `instruction` : optionnel ; à défaut, utilise `agent.description` puis `agent.name`.
- `project_id` : optionnel ; rattache le run à un chantier.

**Réponse 202** : `TaskRead` (la tâche créée, statut `running`). L'agent passe en `status = "running"`.

**Erreurs** :
- **400** si l'agent est désactivé (`detail = "Agent desactive: <slug>."`) — journalise `agent.run_rejected`.
- **400** si le `slug` n'est pas présent dans le registre mémoire (`detail = "Aucun agent enregistre pour le slug '<slug>'."`) — journalise `agent.run_rejected`.
- **404** si l'agent (ligne DB) est introuvable.

Cycle de vie en arrière-plan (`_run_agent_task`) : exécute l'agent → si l'agent renvoie un `document_type`, crée un `Document` en `draft` → calcule le risque (`compute_risk`) → si validation requise (`requires_human_validation`), crée une approbation, passe la tâche en `waiting_approval` et le document en `waiting_approval` ; sinon passe la tâche en `completed` (`completed_at` renseigné). L'agent repasse en `idle`. En cas d'exception : tâche `failed` + `error`, agent `idle`, log `agent.run` niveau `error`.

#### `POST /agents/{agent_id}/enable`
Protégé. Passe `enabled = true`. Journalise `agent.enabled`. → `AgentRead`. **404** si introuvable.

#### `POST /agents/{agent_id}/disable`
Protégé. Passe `enabled = false`. Journalise `agent.disabled`. → `AgentRead`. **404** si introuvable.

---

### Tâches (`/tasks`)

> ⚠️ **Voir l'[avertissement d'état du code](#️-avertissement-détat-du-code).** Le fichier `routes/tasks.py` est **absent** ; ce qui suit décrit le **contrat attendu** (préfixe `/tasks` monté dans `main.py`, schémas Pydantic `Task*` présents dans `schemas.py`, et appels du client frontend), et non une route existante.

Endpoints attendus :

#### `GET /tasks`
Protégé (attendu). Liste des tâches. → `TaskRead[]`.
Appelé par le frontend via `api.listTasks()`.

#### `GET /tasks/{task_id}`
Protégé (attendu). → `TaskRead`. **404** attendu si introuvable.
Appelé par le frontend via `api.getTask(id)`.

#### `PATCH /tasks/{task_id}`
Protégé (attendu). Mise à jour partielle. → `TaskRead`.
Appelé par le frontend via `api.updateTask(id, input)`.

**Corps de mise à jour utilisé par le frontend** (`UpdateTaskInput`) : `title?`, `status?`, `priority?`, `result?`, `error?`.

**Schéma Pydantic `TaskUpdate`** (champs optionnels disponibles côté backend) : `title`, `instruction`, `project_id`, `command_id`, `agent_id`, `status`, `priority`, `result`, `error`, `completed_at`.

> Le contrat global mentionne aussi `POST /tasks` (création via `TaskCreate`), mais le client frontend ne l'appelle pas. Champs `TaskCreate` : `title` (requis), `instruction` (requis), `project_id?`, `command_id?`, `agent_id?`, `status` (défaut `pending`), `priority` (défaut `normal`).

Forme `TaskRead` (renvoyée) : voir [Tâche](#tâche-task).

---

### Approbations (`/approvals`)

Validations humaines des sorties sensibles. Une approbation `pending` est créée par l'orchestrateur ; un opérateur l'accepte ou la rejette ici. La décision est propagée à la tâche et aux documents liés via `apply_decision`, qui écrit le log `approval.decided`.

#### `GET /approvals`
Protégé. Approbations, plus récentes d'abord.

**Query** : `status` (optionnel : `pending` | `accepted` | `rejected`).

**Réponse 200** : `ApprovalRead[]`.

#### `POST /approvals/{approval_id}/accept`
Protégé. Accepte une approbation `pending`.

**Corps** (`ApprovalDecision`)
```json
{ "note": "Validé, RAS." }
```
- `note` : string, optionnel.

**Effets** : approbation → `accepted` (`decision_by` = email, `decided_at` horodaté) ; documents liés (rattachés à la même tâche) → `approved` ; tâche liée → `completed` (`completed_at`).

**Réponse 200** : `ApprovalRead`. **404** si introuvable (`detail = "Validation introuvable."`). **409** si déjà tranchée (`detail = "Cette validation a deja ete tranchee."`).

#### `POST /approvals/{approval_id}/reject`
Protégé. Rejette une approbation `pending`.

**Corps** : `ApprovalDecision` (`{ "note": "..." }`, optionnel).

**Effets** : approbation → `rejected` ; documents liés → `rejected` ; tâche liée → `cancelled`.

**Réponse 200** : `ApprovalRead`. **404** / **409** identiques à `accept`.

> Pas d'endpoint de création/listing par id : les approbations naissent exclusivement de l'orchestration.

---

### Documents (`/documents`)

Artefacts générés (devis, comptes-rendus, réponses AO…). **Toujours créés en `draft`** ; jamais envoyés ni supprimés directement. Surface lecture + création. Routes déclarées avec et sans slash final.

#### `GET /documents`
Protégé. Documents, plus récents d'abord.

**Query** : `project_id` (UUID, optionnel), `status` (`DocumentStatus`, optionnel : `draft` | `waiting_approval` | `approved` | `rejected` | `sent` | `archived`).

**Réponse 200** : `DocumentRead[]`.

#### `POST /documents`
Protégé. Crée un document. **Le statut est forcé à `draft`** quel que soit le statut fourni dans le corps.

**Corps** (`DocumentCreate`)
```json
{
  "document_type": "quote",
  "title": "Devis rénovation toiture",
  "project_id": "uuid-optionnel",
  "task_id": "uuid-optionnel",
  "file_path": null,
  "content": { "lignes": [] },
  "status": "draft"
}
```
- `document_type` : string, **requis**. `title` : string, **requis**.
- `project_id`, `task_id`, `file_path`, `content` : optionnels.
- `status` : ignoré côté serveur (forcé à `draft`).

**Réponse 201** : `DocumentRead`.

#### `GET /documents/{document_id}`
Protégé. → `DocumentRead`. **404** si introuvable (`detail = "Document introuvable."`).

> Pas de `PATCH /documents/{id}` exposé (les transitions de statut passent par le pipeline d'approbation). Le schéma `DocumentUpdate` existe mais n'est pas branché à une route.

---

### Logs (`/logs`)

Journal d'audit en **append-only**. Surface **lecture seule** (aucun POST : les logs sont écrits par `core/audit_logger.log_event`). Routes déclarées avec et sans slash final.

#### `GET /logs`
Protégé. Logs, plus récents d'abord.

**Query** : `level` (optionnel), `event_type` (optionnel), `limit` (int 1–1000, défaut 100).

**Réponse 200** : `LogRead[]`.

#### `GET /logs/{project_id}`
Protégé. Logs d'un projet donné, plus récents d'abord.

**Query** : `level`, `event_type`, `limit` (mêmes bornes).

**Réponse 200** : `LogRead[]`. **404** si le projet n'existe pas (`detail = "Projet introuvable."`).

`event_type` observés dans le code : `command.received`, `command.routing`, `command.completed`, `command.failed`, `task.created`, `task.completed`, `agent.run`, `agent.run_rejected`, `agent.created`, `agent.updated`, `agent.enabled`, `agent.disabled`, `document.generated`, `approval.requested`, `approval.decided`, `project.created`, `project.updated`.

`level` utilisés : `info`, `warning`, `error`.

---

## Schémas de réponse (formes JSON)

Toutes les dates sont des `datetime` ISO 8601 avec fuseau (UTC). Tous les `id` et FK sont des UUID.

### Projet (`ProjectRead`)
```json
{
  "id": "uuid", "name": "str", "client_name": "str|null", "address": "str|null",
  "project_type": "str|null", "status": "str", "description": "str|null",
  "created_at": "datetime", "updated_at": "datetime"
}
```

### Commande OpenClaw (`OpenClawCommandRead`)
```json
{
  "id": "uuid", "source": "str", "project_id": "uuid|null", "intent": "str|null",
  "instruction": "str", "status": "CommandStatus", "risk_level": "RiskLevel",
  "requires_approval": false, "result": "object|null",
  "created_at": "datetime", "updated_at": "datetime"
}
```

### Agent (`AgentRead`)
```json
{
  "id": "uuid", "name": "str", "slug": "str", "role": "str|null",
  "description": "str|null", "agent_type": "str|null", "version": "str",
  "status": "str", "enabled": true, "risk_level": "RiskLevel",
  "config": "object|null", "input_schema": "object|null", "output_schema": "object|null",
  "created_at": "datetime", "updated_at": "datetime"
}
```

### Tâche (`TaskRead`)
```json
{
  "id": "uuid", "project_id": "uuid|null", "command_id": "uuid|null", "agent_id": "uuid|null",
  "title": "str", "instruction": "str", "status": "TaskStatus", "priority": "str",
  "result": "object|null", "error": "str|null",
  "created_at": "datetime", "updated_at": "datetime", "completed_at": "datetime|null"
}
```

### Approbation (`ApprovalRead`)
```json
{
  "id": "uuid", "project_id": "uuid|null", "command_id": "uuid|null", "task_id": "uuid|null",
  "title": "str", "description": "str|null", "status": "ApprovalStatus", "risk_level": "RiskLevel",
  "payload": "object|null", "decision_by": "str|null", "decision_note": "str|null",
  "created_at": "datetime", "decided_at": "datetime|null"
}
```

### Document (`DocumentRead`)
```json
{
  "id": "uuid", "project_id": "uuid|null", "task_id": "uuid|null",
  "document_type": "str", "title": "str", "file_path": "str|null", "content": "object|null",
  "status": "DocumentStatus", "created_at": "datetime", "updated_at": "datetime"
}
```

### Log (`LogRead`)
```json
{
  "id": "uuid", "project_id": "uuid|null", "command_id": "uuid|null",
  "task_id": "uuid|null", "agent_id": "uuid|null", "level": "str",
  "event_type": "str", "message": "str", "payload": "object|null", "created_at": "datetime"
}
```

---

## Énumérations

Valeurs (chaînes) définies dans `enums.py` :

- **TaskStatus** : `pending` · `assigned` · `running` · `waiting_approval` · `completed` · `failed` · `cancelled`
- **RiskLevel** : `low` · `medium` · `high` · `blocked`
- **DocumentStatus** : `draft` · `waiting_approval` · `approved` · `rejected` · `sent` · `archived`
- **ApprovalStatus** : `pending` · `accepted` · `rejected`
- **CommandStatus** : `received` · `routing` · `running` · `waiting_approval` · `completed` · `failed`

---

## Orchestration des commandes

Implémentée dans `core/command_router.py` (`process_command`, lancée en `BackgroundTasks` par `POST /openclaw/command`). Étapes :

1. **`command.received`** — la commande est journalisée.
2. **Classification de l'intention** (`classify_intent`) → statut `routing`, log `command.routing`. Priorité :
   1. `intent` fourni s'il est dans la whitelist ;
   2. classification LLM (`classify_intent_llm`) si une clé Anthropic est présente ;
   3. heuristique mots-clés FR (`devis`→`create_quote`, `devis`+`photo`→`create_quote_from_photo`, `appel d'offre`/`ao`/`dce`→`analyze_tender`, `compte-rendu`/`visite`→`create_site_report`, `photo`→`analyze_photo`) ;
   4. défaut `analyze_photo`.
3. **Résolution de l'agent** via la whitelist `INTENT_TO_AGENT` :

   | Intent | Agent (slug) |
   |--------|--------------|
   | `analyze_photo` | `photo_analysis_agent` |
   | `create_quote` | `quote_agent` |
   | `create_quote_from_photo` | `quote_agent` |
   | `create_site_report` | `site_report_agent` |
   | `analyze_tender` | `tender_agent` |

   Si l'intent est hors whitelist, si l'agent est introuvable en base, ou s'il est désactivé → commande `failed`, log `command.failed` (niveau `error`).
4. **Création de la tâche** (`running`), agent `running`, commande `running`, log `task.created`.
5. **Exécution de l'agent** (`registry.get(slug).run(...)`), log `agent.run` (avec indicateur `stub`). En cas d'exception : tâche `failed` + `error`, commande `failed`.
6. **Document éventuel** : si l'agent renvoie un `document_type`, un `Document` est créé en `draft`, log `document.generated`.
7. **Risque & approbation** : `compute_risk(intent, document_type)` puis `requires_human_validation(...)`. Le `risk_level` est reporté sur la commande.
   - **Si validation requise** : `create_approval` (log `approval.requested`, niveau `warning`), tâche → `waiting_approval`, document → `waiting_approval`, commande → `waiting_approval` (`requires_approval = true`), agent → `idle`.
   - **Sinon** : tâche → `completed` (`completed_at`), commande → `completed`, agent → `idle`, log `command.completed`.

Le `result` de l'agent est stocké sur la tâche (`task.result`) et sur la commande (`command.result`).

---

## Moteur de risque

`core/risk_engine.py`. Deux fonctions pures.

### `compute_risk(intent?, document_type?, action?) -> RiskLevel`
Le niveau le plus élevé l'emporte : `blocked` > `high` > `medium` > `low`.

- **blocked** si `action` ∈ { `delete_database`, `expose_secrets` }.
- **high** si `action` ∈ { `send_to_client`, `delete`, `external_action`, `update_validated_data` }.
- **medium** si `document_type` ∈ { `quote`, `tender_response`, `site_report`, `document_update` } **ou** `intent` ∈ { `create_quote`, `create_quote_from_photo`, `create_site_report`, `analyze_tender` }.
- **low** si `intent` = `analyze_photo` (et par défaut).

### `requires_human_validation(risk, document_type?, requires_approval=false, action?) -> bool`
Renvoie `true` (validation humaine obligatoire) si **l'une** de ces conditions est vraie :

- `risk` ∈ { `high`, `blocked` } ;
- `requires_approval` est explicitement `true` ;
- `document_type` ∈ { `quote`, `tender_response` } ;
- `action == "send_to_client"` ;
- `risk == medium` **et** `document_type` est une sortie client ({ `quote`, `tender_response` }).

---

## Agents IA & mode dégradé (stub)

- Modèle LLM : `OPENCLAW_MODEL` (défaut `claude-opus-4-8`), via le SDK `anthropic` (`AsyncAnthropic`).
- **Si `ANTHROPIC_API_KEY` est absente** : aucun client n'est instancié, `llm_available()` renvoie `false`, et les agents renvoient un résultat **stub** clairement marqué (`{"stub": true, ...}`) respectant le format attendu. L'application reste fonctionnelle de bout en bout (classification par heuristique, documents en brouillon, approbations, journalisation).
- Format minimal renvoyé par un agent produisant un document : `{ "document_type", "title", "status": "draft", "content": {...} }` (l'agent photo peut ne pas produire de document client).

---

## Référence : méthodes du client frontend

`apps/web/lib/api.ts` (base = `NEXT_PUBLIC_API_URL` ou `http://localhost:8000`, en-tête `Authorization: Bearer <token>` ajouté sauf pour `login`) :

| Méthode client | Appel HTTP |
|----------------|-----------|
| `login(input)` | `POST /auth/login` (sans auth) |
| `me()` | `GET /auth/me` |
| `sendCommand(input)` | `POST /openclaw/command` |
| `listCommands()` | `GET /openclaw/commands` |
| `getCommand(id)` | `GET /openclaw/commands/{id}` |
| `listProjects()` | `GET /projects` |
| `getProject(id)` | `GET /projects/{id}` |
| `createProject(input)` | `POST /projects` |
| `updateProject(id, input)` | `PATCH /projects/{id}` |
| `listAgents()` | `GET /agents` |
| `getAgent(id)` | `GET /agents/{id}` |
| `updateAgent(id, input)` | `PATCH /agents/{id}` |
| `runAgent(id, input?)` | `POST /agents/{id}/run` |
| `enableAgent(id)` | `POST /agents/{id}/enable` |
| `disableAgent(id)` | `POST /agents/{id}/disable` |
| `listTasks()` | `GET /tasks` |
| `getTask(id)` | `GET /tasks/{id}` |
| `updateTask(id, input)` | `PATCH /tasks/{id}` |
| `listApprovals()` | `GET /approvals` |
| `acceptApproval(id, input?)` | `POST /approvals/{id}/accept` |
| `rejectApproval(id, input?)` | `POST /approvals/{id}/reject` |
| `listDocuments()` | `GET /documents` |
| `getDocument(id)` | `GET /documents/{id}` |
| `listLogs()` | `GET /logs` |
| `listProjectLogs(projectId)` | `GET /logs/{projectId}` |

> Le client n'utilise pas les query params de filtrage (`limit`, `status`, `level`, `event_type`, `project_id`) ; ils restent disponibles côté backend.

# Agents IA — BTP OpenClaw Cockpit

Ce document décrit le système de sous-agents du backend (`services/api`) : le
registre modulaire, la classe de base `BaseAgent`, les quatre agents métier
livrés, la procédure pour ajouter / modifier / désactiver un agent, la
configuration JSONB stockée en base et les prompts système.

Il décrit **le code réellement en place**. Aucune fonctionnalité non implémentée
n'est documentée ici.

---

## 1. Principe d'autorité

Le backend FastAPI est l'autorité. Un agent **ne touche jamais** la base ni le
système de fichiers : il reçoit un dictionnaire d'entrée validé, appelle le LLM
(ou renvoie un *stub* si aucune clé API n'est configurée) et **retourne toujours
un dictionnaire**. C'est l'orchestrateur (`core/command_router.py`) — ou la
route de run manuel (`routes/agents.py`) — qui persiste le résultat, crée le
document en `draft`, calcule le risque et ouvre une validation humaine si
nécessaire.

Voir `docs/` et le code de `core/command_router.py` pour le détail de
l'orchestration ; ce document se concentre sur les agents eux-mêmes.

---

## 2. Le registre modulaire

Fichier : `services/api/agents/registry.py`

Le registre fait correspondre un **slug** d'agent à sa **classe**, et fournit
des instances à l'orchestrateur.

```python
class AgentRegistry:
    def register(self, cls: type[BaseAgent]) -> None  # enregistre cls sous cls.slug
    def get(self, slug: str) -> BaseAgent             # renvoie une NOUVELLE instance
    def list(self) -> list[dict]                      # métadonnées de chaque agent
```

- `register(cls)` indexe la classe par son attribut de classe `cls.slug`.
- `get(slug)` instancie l'agent (`cls()`). Slug inconnu → `ValueError`.
- `list()` renvoie `get_metadata()` pour chaque agent enregistré.

Une instance unique `registry` est exportée par le module et enregistre les
quatre agents au chargement :

```python
registry = AgentRegistry()
registry.register(PhotoAnalysisAgent)
registry.register(QuoteAgent)
registry.register(SiteReportAgent)
registry.register(TenderAgent)
```

Le registre est **en mémoire**. Il est la source de vérité pour :

- le **seed** (`seed.py`) : au premier démarrage, une ligne `Agent` est créée en
  base à partir de `registry.list()` pour chaque agent (voir §6) ;
- l'**orchestrateur** : `process_command` résout le slug via la whitelist
  d'intents puis appelle `registry.get(slug).run(...)` ;
- le **run manuel** : `POST /agents/{id}/run` vérifie que le slug de la ligne
  `Agent` existe bien dans le registre avant d'exécuter.

> Conséquence : la ligne en base (`agents`) sert au pilotage (activer/désactiver,
> versions, config affichée dans le cockpit), mais le **code exécuté** vient
> toujours du registre en mémoire, indexé par slug. Le slug est donc le lien
> entre la table `agents` et la classe Python.

---

## 3. `BaseAgent`

Fichier : `services/api/agents/base.py`

Classe abstraite (`ABC`) dont héritent tous les agents.

### Attributs de classe (à surcharger)

| Attribut            | Type   | Défaut             | Rôle                                                        |
| ------------------- | ------ | ------------------ | ----------------------------------------------------------- |
| `slug`              | `str`  | `"base_agent"`     | Identifiant unique, clé du registre et de la table `agents`.|
| `name`              | `str`  | `"Base Agent"`     | Nom affiché (FR).                                           |
| `role`              | `str`  | `"base"`           | Rôle métier ; sert aussi de `agent_type` dans les métadonnées.|
| `description`       | `str`  | `"Abstract base agent."` | Description (FR).                                     |
| `version`           | `str`  | `"1.0.0"`          | Version de l'agent.                                         |
| `risk_level`        | `str`  | `"low"`            | Risque de base de l'agent (`low`/`medium`/`high`/`blocked`).|
| `requires_approval` | `bool` | `False`            | L'agent exige-t-il une validation humaine systématique.     |

### Méthodes

```python
async def run(self, input_data: dict) -> dict      # abstrait — à implémenter
def validate_input(self, input_data: dict) -> bool # permissif par défaut (True)
def get_metadata(self) -> dict                     # description sérialisable
```

- **`run(input_data)`** — méthode abstraite, cœur de l'agent. Contrat impératif :
  - elle doit **toujours retourner un `dict`** ;
  - elle ne doit **jamais lever d'exception** sur un LLM manquant ni sur une
    erreur d'appel : dans ces cas, elle retourne un **stub** clairement marqué
    (`"stub": true`) respectant le même format (voir §4).
- **`validate_input`** — permissif par défaut (`return True`). Aucun agent livré
  ne le surcharge aujourd'hui.
- **`get_metadata()`** — renvoie :

  ```python
  {
      "slug", "name", "role", "description",
      "agent_type": self.role,   # agent_type = role
      "version", "risk_level", "requires_approval",
      "input_schema": {},        # vide par défaut
      "output_schema": {},       # vide par défaut
  }
  ```

  `input_schema` et `output_schema` sont **vides** au niveau du code des agents ;
  le format réel des entrées/sorties est décrit ci-dessous et dans les prompts.

---

## 4. Format de sortie commun

Tout agent **producteur de document** retourne au minimum :

```json
{
  "document_type": "<quote | tender_response | site_report | photo_report>",
  "title": "<titre FR>",
  "status": "draft",
  "content": { ... }
}
```

- `status` vaut toujours `"draft"` : un agent ne produit jamais autre chose
  qu'un brouillon.
- En mode dégradé (clé API absente → `LLMUnavailable`, ou toute autre erreur),
  le même dictionnaire est renvoyé avec en plus `"stub": true` et un `content`
  cohérent (champs vides / messages explicites). L'application reste
  fonctionnelle sans clé API.

L'orchestrateur lit `document_type` pour décider s'il crée une ligne
`documents` (statut `draft`), et le passe au moteur de risque.

---

## 5. Les quatre agents

Les quatre classes vivent dans `services/api/agents/` et héritent de
`BaseAgent`. Chacune appelle `agents.llm.complete_json(system, user, images=…)`
et retombe sur un stub en cas de `LLMUnavailable` ou d'erreur.

### Tableau de synthèse

| Agent                 | `slug`                 | `role` / `agent_type` | Intent(s) déclencheur(s)                    | `document_type`   | `risk_level` | `requires_approval` | Validation humaine en pratique |
| --------------------- | ---------------------- | --------------------- | ------------------------------------------- | ----------------- | ------------ | ------------------- | ------------------------------ |
| `PhotoAnalysisAgent`  | `photo_analysis_agent` | `photo_analysis`      | `analyze_photo`                             | `photo_report`    | `low`        | `False`             | Non                            |
| `QuoteAgent`          | `quote_agent`          | `quote`               | `create_quote`, `create_quote_from_photo`   | `quote`           | `medium`     | `True`              | **Oui** (toujours)             |
| `SiteReportAgent`     | `site_report_agent`    | `site_report`         | `create_site_report`                        | `site_report`     | `low`        | `False`             | Non                            |
| `TenderAgent`         | `tender_agent`         | `tender`              | `analyze_tender`                            | `tender_response` | `medium`     | `True`              | **Oui** (toujours)             |

> La colonne « Validation humaine en pratique » résulte du **moteur de risque**
> (`core/risk_engine.py`), pas seulement de l'attribut `requires_approval` de
> l'agent. Voir §5.5.

### 5.1 PhotoAnalysisAgent — `analyze_photo`

Fichier : `agents/photo_analysis_agent.py`

Analyse une ou plusieurs photos de chantier (LLM vision) et décrit
factuellement les travaux visibles, leur état et les points d'attention, sans
rien inventer.

- **Entrée** : `instruction` (texte) et `image_paths` (liste de chemins de
  fichiers). Les images sont lues et encodées en base64 ; un fichier illisible
  est ignoré (`OSError`) sans casser le run. S'il n'y a aucune image, l'agent
  s'appuie uniquement sur le contexte texte.
- **Sortie** `content` : `{ "observations": str, "travaux_visibles": [str],
  "points_attention": [str] }`.
- **`document_type`** : `photo_report`. C'est le seul agent dont la sortie n'est
  **pas** une sortie client : risque `low`, pas de validation humaine.

### 5.2 QuoteAgent — `create_quote`, `create_quote_from_photo`

Fichier : `agents/quote_agent.py`

Métreur BTP : rédige un devis clair et prudent. N'invente jamais de mesures ;
toute information manquante devient une **hypothèse** visible.

- **Entrée** : `instruction`, `project_id`.
- **Logique serveur** : les lignes du LLM sont normalisées (`_normalize_lines`)
  et **les totaux sont systématiquement recalculés côté serveur**
  (`_build_content`), indépendamment de ce que renvoie le LLM. TVA par défaut :
  `DEFAULT_TVA_RATE = 0.20`. Le prompt interdit explicitement au LLM de renvoyer
  un total.
- **Sortie** `content` :

  ```json
  {
    "lines": [{ "label": str, "qty": number, "unit": str,
                "unit_price_ht": number, "total_ht": number }],
    "total_ht": number,
    "tva_rate": 0.20,
    "total_tva": number,
    "total_ttc": number,
    "hypotheses": [str]
  }
  ```

- **`document_type`** : `quote`. `risk_level = medium`, `requires_approval =
  True` → validation humaine **toujours** requise (devis = sortie client).

### 5.3 SiteReportAgent — `create_site_report`

Fichier : `agents/site_report_agent.py`

Conducteur de travaux : rédige un compte-rendu de visite de chantier structuré,
factuel. Champ laissé **vide** si l'information n'est pas fournie (pas de
déduction).

- **Entrée** : `instruction`, `project_id`.
- **Sortie** `content` : `{ "date": str, "present": [str], "constats": [str],
  "actions": [str], "reserves": [str] }`.
- **`document_type`** : `site_report`. `risk_level = low`, `requires_approval =
  False` → pas de validation humaine (compte-rendu interne, non client).

### 5.4 TenderAgent — `analyze_tender`

Fichier : `agents/tender_agent.py`

Responsable d'appels d'offres : analyse un DCE / appel d'offres. N'invente
jamais d'exigence ; une information manquante est signalée dans
`points_vigilance`.

- **Entrée** : `instruction`, `project_id`.
- **Sortie** `content` : `{ "pieces_demandees": [str], "criteres": [str],
  "delais": str, "points_vigilance": [str] }`.
- **`document_type`** : `tender_response`. `risk_level = medium`,
  `requires_approval = True` → validation humaine **toujours** requise.

### 5.5 Pourquoi devis et appel d'offres exigent toujours une validation

Le moteur de risque `core/risk_engine.py` tranche, en plus de l'attribut
`requires_approval` de l'agent. `requires_human_validation(...)` renvoie `True`
notamment si :

- le risque est `high` ou `blocked` ;
- l'appelant a positionné `requires_approval` ;
- **le `document_type` est `quote` ou `tender_response`** ;
- l'action est `send_to_client` ;
- le risque est `medium` ET le document est une sortie client (`quote`,
  `tender_response`).

De son côté, `compute_risk(intent, document_type, action)` classe au niveau le
plus élevé qui s'applique (`blocked > high > medium > low`). Les
`document_type` `quote`, `tender_response`, `site_report`, `document_update`
sont `medium` ; l'intent `analyze_photo` est `low`.

Conséquence concrète : un **devis** (`quote`) et une **analyse d'appel d'offres**
(`tender_response`) passent **toujours** par une validation humaine (document +
tâche + commande passent en `waiting_approval`). Un **rapport photo** et un
**compte-rendu** se terminent directement en `completed`.

---

## 6. Configuration JSONB en base (`config`, `input_schema`, `output_schema`)

La table `agents` (modèle `Agent` dans `models.py`) porte trois colonnes JSON
nullable :

```python
config:        Mapped[dict | None]  # JSON
input_schema:  Mapped[dict | None]  # JSON
output_schema: Mapped[dict | None]  # JSON
```

Au **seed** (`seed.py`), pour chaque agent du registre, la ligne est créée avec :

```python
config={}, input_schema={}, output_schema={}
```

Autrement dit, ces trois colonnes sont **initialisées vides** (`{}`). Le code
des agents **ne lit pas** `config` aujourd'hui : il n'existe aucune
fonctionnalité de paramétrage par-config en place. Ces colonnes sont prévues
pour piloter/afficher des métadonnées par agent et sont **modifiables via
l'API** (`PATCH /agents/{id}`) ou directement en base, mais modifier `config`
n'altère pas le comportement d'exécution tant qu'aucun agent ne le consomme.

Autres champs pilotables de la ligne `Agent` : `name`, `role`, `description`,
`agent_type` (mis à `"builtin"` au seed), `version`, `status`
(`idle`/`running`), `enabled`, `risk_level`.

> Ne pas confondre : `risk_level` sur la ligne `agents` est une métadonnée
> d'affichage. Le risque **effectif** d'une exécution est (re)calculé par
> `risk_engine.compute_risk(...)` à partir de l'intent et du `document_type`.

---

## 7. Cycle de vie d'une exécution (rappel)

Déclenchée par OpenClaw via `POST /openclaw/command`, l'orchestration
`process_command` (en `BackgroundTasks`) :

1. journalise `command.received` ;
2. classe l'intent (whitelist > LLM > heuristique FR) → `command.routing` ;
3. résout l'agent via `INTENT_TO_AGENT` ; **rejette** (commande `failed`, log
   `error`) si l'intent est hors whitelist, si l'agent est introuvable ou s'il
   est **désactivé** ;
4. crée une `task` (`running`), passe `agent.status = "running"` →
   `task.created` ;
5. exécute `registry.get(slug).run(input)` → `agent.run` (le payload contient
   `instruction`, `intent`, `project_id`, `command_id`) ;
6. si l'agent renvoie un `document_type`, crée un `documents` en `draft` →
   `document.generated` ;
7. calcule le risque et, si validation requise, crée une `approval`, passe
   tâche/document/commande en `waiting_approval` → `approval.requested` ;
8. sinon, termine : tâche `completed`, commande `completed` →
   `command.completed`.

La whitelist `INTENT_TO_AGENT` (dans `command_router.py`) est l'unique
correspondance intent → slug autorisée :

```python
INTENT_TO_AGENT = {
    "analyze_photo":            "photo_analysis_agent",
    "create_quote":             "quote_agent",
    "create_quote_from_photo":  "quote_agent",
    "create_site_report":       "site_report_agent",
    "analyze_tender":           "tender_agent",
}
```

Le run **manuel** `POST /agents/{id}/run` suit la même logique d'exécution et
**rejette en `400`** un agent désactivé ou un slug absent du registre.

---

## 8. Ajouter un nouvel agent

1. **Créer le module** `services/api/agents/<mon_agent>.py` avec une classe
   héritant de `BaseAgent` :
   - définir les attributs de classe : `slug` (unique, en snake_case), `name`,
     `role`, `description`, `version`, `risk_level`, `requires_approval` ;
   - écrire un `SYSTEM_PROMPT` métier en **français**, imposant une réponse
     **JSON stricte** (voir §9) ;
   - implémenter `async def run(self, input_data: dict) -> dict` : appeler
     `complete_json(system=SYSTEM_PROMPT, user=…, images=…)`, normaliser le
     résultat, et **toujours** retourner
     `{document_type, title, status: "draft", content: {...}}` ;
   - prévoir un `_stub(...)` renvoyant le **même format** avec `"stub": true`
     pour le cas `LLMUnavailable` / erreur (envelopper l'appel LLM dans un
     `try/except (LLMUnavailable, Exception)`).
2. **Enregistrer** la classe dans `agents/registry.py` :
   `registry.register(MonAgent)`.
3. **Câbler l'intent** dans `core/command_router.py` :
   - ajouter une entrée `"<mon_intent>": "<mon_slug>"` à `INTENT_TO_AGENT` ;
   - si l'heuristique de secours `_heuristic_intent` doit savoir router cet
     intent sans LLM, y ajouter les mots-clés correspondants.
4. **Classer le risque** dans `core/risk_engine.py` si nécessaire : ajouter
   l'intent à `_LOW_INTENTS` ou `_MEDIUM_INTENTS`, et le `document_type` à
   `_MEDIUM_DOCUMENT_TYPES` et/ou `_CLIENT_FACING_DOCUMENT_TYPES` selon qu'il
   s'agit d'une sortie client devant être validée.
5. **Seed** : aucune action manuelle. Le seed étant **idempotent** (no-op si la
   table `agents` contient déjà des lignes), un nouvel agent n'apparaîtra en
   base que sur une base vierge. Sur une base déjà seedée, créer la ligne via
   `POST /agents` (ou repartir d'une base vide en dev). Le code exécuté provient
   du registre dès que le slug existe en base.

---

## 9. Modifier un agent

- **Comportement / prompt** : éditer le `SYSTEM_PROMPT` et/ou la logique de
  `run` dans le module de l'agent. Conserver le **contrat de sortie** (JSON
  strict côté LLM, dictionnaire `{document_type, title, status, content}` côté
  `run`) et le **stub**. Garder le LLM dépourvu des paramètres interdits sur
  `claude-opus-4-8` (pas de `temperature`, `top_p`, `top_k`, `budget_tokens`,
  ni bloc `thinking`) : ces règles sont centralisées dans `agents/llm.py`,
  n'appelez le modèle qu'à travers `complete_json`.
- **Métadonnées affichées** (nom, description, version, `risk_level` indicatif,
  `config`) : modifiables à chaud via `PATCH /agents/{id}` ou en base. Attention
  : modifier `risk_level` sur la ligne ne change pas le risque effectif calculé
  par le moteur de risque.
- **Routage** : pour changer quel agent répond à un intent, éditer
  `INTENT_TO_AGENT`. Pour changer la politique de validation, éditer
  `risk_engine.py` (`compute_risk` / `requires_human_validation`).

---

## 10. Désactiver un agent

Un agent désactivé n'est **plus exécuté**, ni par l'orchestrateur, ni en run
manuel.

- **Via l'API** :
  - `POST /agents/{id}/disable` → `enabled = False` (log `agent.disabled`) ;
  - `POST /agents/{id}/enable` → `enabled = True` (log `agent.enabled`).
- **Effets** :
  - `process_command` : si l'intent route vers un agent désactivé, la commande
    passe en `failed` avec le message « Agent desactive: `<slug>` » et un log
    `error` ; aucune tâche n'est exécutée.
  - `POST /agents/{id}/run` : renvoie `400` (log `agent.run_rejected`,
    raison `"disabled"`).

> Conformément à la politique V1, il n'existe **aucune suppression définitive**
> d'agent : on désactive (`enabled = False`), on ne supprime pas.

---

## 11. Les prompts système (résumé)

Chaque prompt est en français, impose un rôle métier et **force une réponse JSON
stricte** (objet unique, sans texte autour ; les fences ```json éventuelles sont
retirées par `llm._strip_json_fences`). Tous interdisent l'invention
d'informations.

- **`PhotoAnalysisAgent`** — « expert technique du BTP qui analyse des photos de
  chantier ». N'invente rien si l'info n'est pas visible. JSON :
  `{observations, travaux_visibles[], points_attention[]}`.
- **`QuoteAgent`** — « métreur BTP expérimenté ». N'invente jamais de mesures ;
  rend visibles les hypothèses ; **ne renvoie pas de total** (recalculé serveur).
  JSON : `{title, lines[{label, qty, unit, unit_price_ht}], hypotheses[]}`.
- **`SiteReportAgent`** — « conducteur de travaux ». Laisse un champ vide si
  l'info n'est pas fournie. JSON :
  `{date, present[], constats[], actions[], reserves[]}`.
- **`TenderAgent`** — « responsable d'appels d'offres BTP ». Signale le manquant
  dans `points_vigilance` plutôt que de deviner. JSON :
  `{title, pieces_demandees[], criteres[], delais, points_vigilance[]}`.

En complément, le **routeur d'intentions** (`llm.classify_intent_llm`) utilise
son propre prompt système (« routeur d'intentions pour un cockpit BTP ») qui
contraint le modèle à répondre `{"intent": "<valeur autorisée>"}` parmi la
whitelist ; valeur inconnue → repli sur le premier intent autorisé.

---

## 12. Mode dégradé (sans clé API)

Si `ANTHROPIC_API_KEY` est absente, `agents/llm.py` n'instancie pas de client
(`llm_available()` renvoie `False`) et `complete_json` lève `LLMUnavailable`.
Chaque agent capte ce cas et renvoie son **stub** (même format, `"stub": true`,
`content` cohérent). L'orchestration continue normalement : documents en
`draft`, risque calculé, validations créées le cas échéant. **L'application ne
plante jamais** faute de clé.

Modèle utilisé quand le client existe :
`MODEL = os.getenv("OPENCLAW_MODEL", "claude-opus-4-8")`.

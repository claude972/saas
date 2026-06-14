# Sécurité — BTP OpenClaw Cockpit

Ce document décrit le modèle de sécurité réellement implémenté en V1.

## 1. Principe fondateur : le backend est l'autorité

OpenClaw (agent maître) **ne modifie jamais directement** la base de données, les
fichiers, le code, les devis validés ni les documents envoyés. Il se contente de
*soumettre une instruction* via `POST /openclaw/command`. Tout le reste est décidé
et exécuté par le backend FastAPI.

```
OpenClaw → Backend (autorité) → Sous-agent → Document (brouillon) → Validation humaine
```

## 2. Garde-fou anti‑injection

Le centre de commande accepte du langage naturel. Pour éviter qu'une instruction
malveillante ne déclenche une action arbitraire :

- le LLM **propose seulement** une intention (`classify_intent_llm`) ;
- le backend **valide cette intention contre une whitelist** (`INTENT_TO_AGENT`
  dans `core/command_router.py`). Toute intention hors whitelist → commande
  `failed`, journalisée ;
- l'agent résolu doit exister **et** être `enabled`, sinon la commande est rejetée ;
- le LLM ne déclenche **jamais** d'action directe : il ne fait que classer et générer
  du contenu de document (toujours en brouillon).

## 3. Authentification

- JWT signé HS256 (`core/security.py`). Login via `POST /auth/login` comparé aux
  identifiants `ADMIN_EMAIL` / `ADMIN_PASSWORD` (variables d'environnement).
- Toutes les routes exigent `get_current_user`, **sauf** `POST /auth/login` et
  `GET /health`.
- V1 = mono‑équipe (un compte). Évolution prévue : Supabase Auth (vérification du
  JWT via JWKS) pour le multi‑utilisateurs.

## 4. Modèle de risque

Calculé par `core/risk_engine.py` :

| Niveau    | Exemples |
|-----------|----------|
| `low`     | analyse photo, brouillon, création de tâche, résumé |
| `medium`  | génération de devis, modification de document, réponse appel d'offre, compte‑rendu officiel |
| `high`    | envoi client, suppression, action externe, modification de données validées |
| `blocked` | suppression de base, accès aux secrets, action système dangereuse |

## 5. Validation humaine obligatoire

`requires_human_validation` déclenche une entrée dans `approvals` lorsque :

- `risk_level = high`, ou
- `requires_approval = true`, ou
- `document_type ∈ {quote, tender_response}`, ou
- `action = send_to_client`, ou
- `risk_level = medium` avec sortie client.

Le cycle de vie d'un document : `draft → waiting_approval → approved | rejected`.
Un devis ou une réponse d'appel d'offre est **toujours** créé en `draft` et ne peut
passer à `approved` qu'après validation humaine (`POST /approvals/{id}/accept`).
L'agent n'exécute jamais l'action finale (envoi, etc.).

## 6. Journalisation

Chaque étape est enregistrée dans `logs` par `core/audit_logger.py` :
`command.received`, `command.routing`, `task.created`, `agent.run`,
`document.generated`, `approval.requested`, `command.completed` / `command.failed`,
ainsi que les erreurs agent/backend.

## 7. Règles de sécurité V1

- Aucune suppression définitive (statuts / soft delete uniquement).
- Aucune action externe automatique.
- Aucun envoi client automatique.
- Aucun agent hors registre ne peut être lancé.
- Tout agent peut être désactivé (`POST /agents/{id}/disable`) ; un agent désactivé
  ne peut pas être exécuté.
- Toutes les commandes et erreurs sont journalisées.

## 8. Secrets & configuration

- `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`,
  `DATABASE_URL` vivent dans l'environnement (`.env`, **gitignoré**).
- Sans `ANTHROPIC_API_KEY`, les agents renvoient des résultats *stub* marqués
  `{"stub": true}` : l'application reste fonctionnelle, sans appel LLM réel.
- **À faire avant la production** : changer `JWT_SECRET` et `ADMIN_PASSWORD`,
  servir en HTTPS, restreindre CORS à l'origine réelle, externaliser le stockage
  fichiers (Supabase Storage), et passer l'auth à Supabase.

## 9. Préparation MCP (future)

La passerelle `services/api/mcp_gateway/` est un squelette vide. Règle cible :

```
OpenClaw → Backend → Agent/Skill → MCP Gateway → Outil externe
```

OpenClaw ne parlera jamais directement aux serveurs MCP.

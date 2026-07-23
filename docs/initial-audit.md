# Audit initial — SaaS Professional Director (Phase 0)

> Mode : **non précisé à l'invocation**. Ce document est produit en lecture seule
> (aucune modification). Choix du mode à confirmer avant toute action (voir fin).

## Nature du produit (déterminant)

`BTP OpenClaw Cockpit` — **SaaS interne mono-locataire**, piloté par l'agent maître
OpenClaw. Le backend FastAPI est l'autorité ; OpenClaw n'écrit jamais directement
en base. Documents produits en brouillon + validations humaines pour les actions
sensibles + journalisation.

**Conséquence directrice :** ce n'est **pas** un SaaS commercial multi-tenant.
Les phases *multi-tenancy*, *matrice RBAC multi-rôles* et *facturation* du
framework **ne s'appliquent pas** en l'état (aucune de ces fonctionnalités n'est
dans le besoin). Elles ne deviennent pertinentes que si une **commercialisation
multi-clients** est décidée.

## Détection technique

| Domaine | Constat |
|---|---|
| Frontend | Next.js 14 (App Router), TS, Tailwind (`apps/web`) |
| Backend | FastAPI, SQLAlchemy 2.0 async (asyncpg), Pydantic v2 (`services/api`) |
| Base de données | PostgreSQL (Railway, `postgres.railway.internal`) |
| Auth | **Mono-admin** (JWT `HS256`, `ADMIN_EMAIL`/`ADMIN_PASSWORD` en env) |
| Facturation | **Aucune** |
| Multi-tenant | **Non** (mono-organisation) |
| Tests | **Aucun** (ni `test_*.py`, ni script `test`/`typecheck`) |
| Scripts web | `dev`, `build`, `start`, `lint` |
| Hébergement | Railway (`web`, `saas`, `Postgres`) + relais SMTP VPS Hostinger |
| Intégrations | LLM (Anthropic/OpenAI/Perplexity), SMTP LWS via relais, MCP/OpenClaw, Supabase (option), export Obat |
| Secrets | `api_secrets` chiffrés (Fernet), `SECRETS_ENCRYPTION_KEY`/`JWT_SECRET` en prod |
| Docs | AGENTS, API, ARCHITECTURE, BRIEF, DEPLOY, SECURITY déjà présents |

Tables (14) : `projects, openclaw_commands, agents, tasks, approvals, documents,
logs, skills, company_settings, system_state, tender_offers, api_secrets,
monitored_sources, veille_config`.

## Table interne de routage (skills réellement disponibles)

| Domaine | Responsable | Vérificateur | Justification |
|---|---|---|---|
| Sécurité | `security-auditor` (agent) | `security-reviewer` (skill) | Auth mono-admin, MCP en admin, relais, secrets, uploads data-URI |
| Backend | `fastapi-developer` (agent) | `code-reviewer` (agent) | Routes export/email/documents, moteur d'approbation |
| Base de données | `postgres-pro` (agent) | `database-optimizer` (agent) | Intégrité, index, migrations, contenu volumineux (photos data-URI) |
| Frontend | `nextjs-developer` (agent) | `impeccable` (skill) | Cockpit, éditeurs documents, ExportBar |
| Tests | `test-automator` (agent) | `qa-expert` (agent) | **Aucun test** aujourd'hui — priorité |
| Qualité web | `web-quality-audit` (skill) | `accessibility` / `performance` | Audit global puis spécialistes ciblés |
| Observabilité | `monitoring-expert` (skill) | `sre-engineer` (skill) | Logs présents ; métriques/alertes à formaliser |
| Revue finale | `code-reviewer` (agent) | `adversarial-review` (skill) | Régressions, dette, conformité |

> Non retenus (hors besoin actuel) : multi-tenancy, RBAC multi-rôles, billing,
> microservices, GraphQL, 3D. Réactivables si commercialisation décidée.

## Risques / gaps prioritaires (à valider)

1. **Aucun test automatisé** — parcours critiques (login, export PDF, email, MCP)
   non couverts. Risque de régression élevé (le produit évolue vite).
2. **Sécurité à revoir** (non destructif) :
   - MCP/OpenClaw agit en **admin** ; l'outil `send_document_email` **envoie
     sans validation** — vérifier que c'est le comportement voulu.
   - Relais SMTP public (`:8443`) protégé par secret partagé — OK, mais pas de
     rate-limiting ; vérifier l'exposition.
   - Photos stockées en **data-URI dans le `content`** → documents/PATCH
     volumineux (poids DB, taille des réponses). Vérifier limites.
   - `ADMIN_PASSWORD`/`JWT_SECRET` — confirmés non-défaut en prod (à re-vérifier).
3. **Pas de `typecheck`/`test` en CI** — `tsc`/lint non bloquants automatiquement.
4. **Observabilité** : journalisation applicative présente, mais pas de métriques
   ni d'alertes formalisées (paiements N/A ; mais webhooks veille, envois email,
   tâches agents pourraient être suivis).

## Ce qui est déjà solide

- Backend « autorité » + validations humaines + journalisation (`logs`).
- Secrets chiffrés (Fernet) ; avertissements de sécurité au démarrage si défauts.
- Déploiement reproductible (Railway + Dockerfiles) ; relais email fonctionnel.
- Documentation d'architecture/déploiement/sécurité existante.

## Mode recommandé

Vu l'état (produit interne **vivant et déployé**), le mode le plus utile est
**`audit`** (constat + priorisation, sans modification), éventuellement suivi de
**`fix`** ciblé (tests critiques + durcissement sécurité) puis **`ship`**.
Les modes `build`/`scale` (multi-tenant, billing) ne sont pertinents que pour une
**commercialisation** — à décider explicitement.

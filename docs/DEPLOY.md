# Déploiement — Railway (tout-en-un)

Tout le cockpit tourne sur **Railway**, dans **un seul projet** avec 3 services :

| Service | Source | Root Directory | Rôle |
|---------|--------|----------------|------|
| **Postgres** | plugin Railway | — | base de données |
| **api** | repo `claude972/saas` | `services/api` | backend FastAPI |
| **web** | repo `claude972/saas` | `apps/web` | frontend Next.js |

La base est créée automatiquement au premier démarrage (`create_all` + seed Villa Ducos). Aucune migration à lancer.

---

## 1. Projet + PostgreSQL

Dashboard Railway → **New Project**. Puis **Add → Database → PostgreSQL**.

---

## 2. Service `api` (backend)

**New Service → GitHub Repo `claude972/saas`.**

- **Settings → Root Directory** = `services/api`
- La *start command* vient du `Procfile` : `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Python est épinglé à 3.11 via `services/api/.python-version`.

**Variables** (Settings → Variables) :

| Variable | Valeur |
|----------|--------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (référence le plugin ; l'app convertit le schéma en `postgresql+asyncpg://` et retire `sslmode`) |
| `JWT_SECRET` | une chaîne aléatoire forte — `openssl rand -hex 32` |
| `ADMIN_EMAIL` | `admin@btp.local` (ou le tien) |
| `ADMIN_PASSWORD` | un vrai mot de passe |
| `ANTHROPIC_API_KEY` | `sk-ant-...` (optionnel — sans clé, les agents renvoient des stubs) |
| `OPENCLAW_MODEL` | `claude-opus-4-8` |
| `FRONTEND_ORIGIN` | l'URL publique du service **web** (à remplir après l'étape 3) |

**Networking → Generate Domain** → note l'URL publique de l'API, ex. `https://api-prod.up.railway.app`.

Vérif : `https://<api>/health` → `{"status":"ok","llm":false}`.

---

## 3. Service `web` (frontend)

**New Service → même repo `claude972/saas`.**

- **Settings → Root Directory** = `apps/web`
- Node épinglé via `apps/web/.nvmrc` (20). Start via `Procfile` (`next start -H 0.0.0.0 -p $PORT`).

**Variables** :

| Variable | Valeur |
|----------|--------|
| `NEXT_PUBLIC_API_URL` | l'URL publique de l'**api** (étape 2) |

> ⚠️ `NEXT_PUBLIC_*` est **inliné au build** : si l'URL de l'API change, il faut **redéployer** le web.

**Networking → Generate Domain** → note l'URL publique du web.

Puis retourne au service **api** → mets `FRONTEND_ORIGIN` = l'URL du web (pour le CORS) → **Redeploy** l'api.

---

## 4. Vérifier

1. `https://<api>/health` → `{"status":"ok",...}`
2. Ouvre `https://<web>` → login `admin@btp.local` / *(ton ADMIN_PASSWORD)* → Dashboard avec Villa Ducos.

---

## 5. Brancher OpenClaw (MCP) sur le cockpit déployé

Le serveur MCP `btp-cockpit` tourne **en local** mais peut pointer vers le backend Railway. Dans `~/.openclaw/openclaw.json`, pour le serveur `btp-cockpit`, change l'`env` :

```json
"env": {
  "COCKPIT_API_URL": "https://<api>.up.railway.app",
  "COCKPIT_EMAIL": "admin@btp.local",
  "COCKPIT_PASSWORD": "<ton ADMIN_PASSWORD Railway>"
}
```

Relance le gateway OpenClaw → OpenClaw pilote désormais le cockpit **déployé**.

---

## Équivalent CLI (`railway`)

```bash
# à la racine du repo (clone local), une fois par service
railway init                                  # crée le projet
railway add --database postgres               # ajoute PostgreSQL

# service api (root services/api configuré dans Settings)
railway variables --set "JWT_SECRET=$(openssl rand -hex 32)" \
                  --set "ADMIN_EMAIL=admin@btp.local" \
                  --set "ADMIN_PASSWORD=..." \
                  --set "OPENCLAW_MODEL=claude-opus-4-8"
railway up                                    # build + deploy
railway domain                                # génère l'URL publique
```

---

## Notes

- **Stockage** : le système de fichiers Railway est **éphémère**. En V1, les documents stockent leur contenu en JSON (DB) et `file_path` est optionnel → OK. Pour des fichiers persistants (PDF, photos) plus tard : **volume Railway** attaché à `services/api/storage`, ou **Supabase Storage**.
- **Sécurité** : change `JWT_SECRET` et `ADMIN_PASSWORD` par de vraies valeurs en production. Restreins `FRONTEND_ORIGIN` à l'URL du web (pas de `*`).

# mailrelay — relais SMTP sur le VPS Hostinger

Railway ferme les ports SMTP sortants. Ce mini-service tourne sur le VPS (qui,
lui, autorise le SMTP) : le backend Railway l'appelle en **HTTPS**, le relais
envoie le mail via **le SMTP LWS**.

```
Cockpit (Railway) ──HTTPS──▶ relais (VPS Hostinger) ──SMTP──▶ LWS (mail.o-m2.fr)
```

## Prérequis
- Un VPS Hostinger avec **Docker** + **docker compose**.
- Un sous-domaine pointant vers l'IP du VPS, ex. `relay.o-m2.fr`
  (ajouter un enregistrement **A** `relay` → IP du VPS dans la zone DNS de `o-m2.fr`).
- Ports **80** et **443** ouverts sur le VPS (Caddy obtient le certificat Let's Encrypt automatiquement).

## Déploiement
```bash
# 1. Récupérer le code sur le VPS
git clone https://github.com/claude972/saas.git
cd saas/services/mailrelay

# 2. Configurer
cp .env.example .env
nano .env        # RELAY_DOMAIN, RELAY_SECRET, SMTP_* (mot de passe LWS)

# 3. Lancer
docker compose up -d --build

# 4. Vérifier (après ~30 s, le temps du certificat TLS)
curl https://relay.o-m2.fr/health
# -> {"status":"ok","smtp_host":true,"secret_set":true}
```

## Test d'envoi (depuis le VPS ou ailleurs)
```bash
curl -X POST https://relay.o-m2.fr/send \
  -H "X-Relay-Secret: <RELAY_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"to":"toi@exemple.fr","subject":"Test relais","text":"ok","from_email":"devis@o-m2.fr","from_name":"OM2","filename":"test.pdf","pdf_base64":"JVBERi0="}'
```

## Côté backend (Railway, service `saas`)
Définir :
- `EMAIL_PROVIDER=relay`
- `MAIL_RELAY_URL=https://relay.o-m2.fr`
- `MAIL_RELAY_SECRET=<le même RELAY_SECRET>`
- `SMTP_FROM=devis@o-m2.fr` (adresse expéditeur — déjà en place)

Les identifiants SMTP (mot de passe LWS) ne sont **plus** nécessaires sur Railway :
ils vivent uniquement sur le VPS.

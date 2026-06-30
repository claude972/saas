"""Mini-relais SMTP — à déployer sur le VPS Hostinger.

Le backend (Railway, qui ne peut pas ouvrir de connexion SMTP sortante) appelle
ce relais en HTTPS. Le relais envoie le mail via le SMTP LWS depuis le VPS, qui
autorise le SMTP sortant. Les identifiants SMTP vivent ICI (sur le VPS), pas
sur Railway.

Authentification : en-tête ``X-Relay-Secret`` qui doit égaler ``RELAY_SECRET``.

Variables d'environnement (sur le VPS) :
  RELAY_SECRET       secret partagé avec le backend (obligatoire)
  SMTP_HOST          ex. mail.o-m2.fr
  SMTP_PORT          465 (SSL) ou 587 (STARTTLS)
  SMTP_USER          ex. devis@o-m2.fr
  SMTP_PASSWORD      mot de passe de la boîte
  SMTP_VERIFY_CERT   "false" pour LWS (cert mutualisé *.lwspanel.com)
"""

from __future__ import annotations

import base64
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_VERIFY_CERT = os.getenv("SMTP_VERIFY_CERT", "true").lower() == "true"
RELAY_SECRET = os.getenv("RELAY_SECRET", "")

app = FastAPI(title="mailrelay")


class SendRequest(BaseModel):
    to: str
    subject: str = ""
    text: str = ""
    from_email: str
    from_name: str = ""
    filename: str = "document.pdf"
    pdf_base64: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "smtp_host": bool(SMTP_HOST), "secret_set": bool(RELAY_SECRET)}


@app.post("/send")
def send(req: SendRequest, x_relay_secret: str = Header(default="")) -> dict:
    if not RELAY_SECRET or x_relay_secret != RELAY_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")
    if not SMTP_HOST:
        raise HTTPException(status_code=500, detail="SMTP non configuré sur le relais")

    msg = EmailMessage()
    msg["From"] = formataddr((req.from_name, req.from_email)) if req.from_name else req.from_email
    msg["To"] = req.to
    msg["Subject"] = req.subject
    msg.set_content(req.text or "")
    try:
        pdf = base64.b64decode(req.pdf_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="pdf_base64 invalide")
    msg.add_attachment(pdf, maintype="application", subtype="pdf", filename=req.filename)

    context = ssl.create_default_context()
    if not SMTP_VERIFY_CERT:
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

    try:
        if SMTP_PORT == 465:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=30) as s:
                if SMTP_USER:
                    s.login(SMTP_USER, SMTP_PASSWORD)
                s.send_message(msg)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as s:
                s.starttls(context=context)
                if SMTP_USER:
                    s.login(SMTP_USER, SMTP_PASSWORD)
                s.send_message(msg)
    except Exception as exc:  # noqa: BLE001 — report SMTP failure to caller
        raise HTTPException(status_code=502, detail=f"smtp error: {exc}")

    return {"status": "sent", "to": req.to}

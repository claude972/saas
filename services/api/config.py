"""Application configuration loaded from environment variables.

Uses pydantic-settings (Pydantic v2). All values have dev-friendly defaults so
the app boots locally without a populated .env file.
"""

import logging
from urllib.parse import urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_config_logger = logging.getLogger("openclaw.config")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database (SQLAlchemy 2.0 async / asyncpg).
    DATABASE_URL: str = "postgresql+asyncpg://openclaw:openclaw@localhost:5432/openclaw"

    # Auth / JWT
    JWT_SECRET: str = "dev-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    # Session longue pour un outil interne mono-admin : ~1 an (525600 min) afin de
    # rester connecté en permanence. Réduire si besoin de sécurité accrue.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 525600

    # Single-admin login (credentials from env)
    ADMIN_EMAIL: str = "admin@btp.local"
    ADMIN_PASSWORD: str = "changeme"

    # Frontend origin(s) for CORS. Comma-separated list supported, e.g.
    # "http://localhost:3000,https://cockpit-web.up.railway.app".
    FRONTEND_ORIGIN: str = "http://localhost:3000"

    # LLM (Anthropic). Empty string => no client, agents return stubs.
    ANTHROPIC_API_KEY: str = ""
    OPENCLAW_MODEL: str = "claude-opus-4-8"

    # LLM — additional providers (Vague 1). Empty string => provider unavailable.
    OPENAI_API_KEY: str = ""
    GOOGLE_API_KEY: str = ""
    DEEPSEEK_API_KEY: str = ""
    DEFAULT_LLM_PROVIDER: str = "anthropic"

    # Perplexity (veille appels d'offres). Empty string => provider unavailable.
    PERPLEXITY_API_KEY: str = ""
    PERPLEXITY_MODEL: str = "sonar"

    # Supabase storage. Empty strings => fallback local filesystem.
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""
    SUPABASE_BUCKET: str = "documents"

    # Browser-use scraping (optional heavy dependency). Disabled by default.
    BROWSER_USE_ENABLED: bool = False
    # LLM model that drives the browser-use agent (navigation/extraction).
    BROWSER_USE_MODEL: str = "claude-sonnet-4-6"

    # Secrets encryption key (Fernet urlsafe-base64, 32 bytes).
    # Empty string => key derived from JWT_SECRET at runtime (see services/crypto.py).
    SECRETS_ENCRYPTION_KEY: str = ""

    # Maximum number of monitored portals extracted concurrently during veille.
    MAX_CONCURRENT_PORTALS: int = 2

    # Secret partagé pour POST /veille/tick (cron externe).
    # Doit être une chaîne non vide en production pour que le tick soit accepté.
    # Laissé vide par défaut pour le développement local (endpoint refusé si vide).
    VEILLE_TICK_SECRET: str = ""

    # Fournisseur d'envoi d'email :
    #   "smtp"  — SMTP direct (OK en local ; BLOQUÉ sur Railway, qui ferme les
    #             ports SMTP sortants 25/465/587).
    #   "brevo" — API HTTPS Brevo (port 443) : seule option fiable sur Railway.
    EMAIL_PROVIDER: str = "smtp"
    BREVO_API_KEY: str = ""

    # Email (SMTP) — envoi des documents (devis) par mail. Vides => envoi désactivé.
    # Railway bloque le port 25 : utiliser 587 (STARTTLS) ou 465 (SSL implicite).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""           # adresse expéditeur ; défaut = SMTP_USER si vide
    SMTP_FROM_NAME: str = ""      # nom affiché de l'expéditeur (optionnel)
    SMTP_USE_TLS: bool = True     # STARTTLS sur 587 ; ignoré si port 465 (SSL implicite)
    # Vérification stricte du certificat TLS. À mettre à False pour les serveurs
    # mutualisés dont le certificat ne correspond pas au nom d'hôte (ex. LWS :
    # cert *.lwspanel.com servi pour mail.<domaine>).
    SMTP_VERIFY_CERT: bool = True

    @property
    def smtp_configured(self) -> bool:
        """True when SMTP host + a sender address are set (envoi possible)."""
        return bool(self.SMTP_HOST and (self.SMTP_FROM or self.SMTP_USER))

    @property
    def email_configured(self) -> bool:
        """True when the active email provider can send (sender + credentials)."""
        sender = self.SMTP_FROM or self.SMTP_USER
        if self.EMAIL_PROVIDER == "brevo":
            return bool(self.BREVO_API_KEY and sender)
        return self.smtp_configured

    @field_validator("DATABASE_URL", mode="after")
    @classmethod
    def _async_dsn(cls, v: str) -> str:
        """Normalize a provider DSN to the asyncpg driver.

        Railway/Heroku inject ``postgres://`` or ``postgresql://``; the async
        engine needs ``postgresql+asyncpg://``. A ``sslmode`` query parameter
        (which asyncpg does not understand) is also dropped.
        """
        if v.startswith("postgres://"):
            v = "postgresql+asyncpg://" + v[len("postgres://") :]
        elif v.startswith("postgresql://"):
            v = "postgresql+asyncpg://" + v[len("postgresql://") :]

        if "sslmode=" in v:
            parts = urlsplit(v)
            query = "&".join(
                kv
                for kv in parts.query.split("&")
                if kv and not kv.startswith("sslmode=")
            )
            v = urlunsplit(
                (parts.scheme, parts.netloc, parts.path, query, parts.fragment)
            )
        return v

    @property
    def cors_origins(self) -> list[str]:
        """FRONTEND_ORIGIN split into a list of allowed CORS origins."""
        origins = [o.strip() for o in self.FRONTEND_ORIGIN.split(",")]
        return [o for o in origins if o] or ["http://localhost:3000"]


settings = Settings()


# ---------------------------------------------------------------------------
# Production safety warnings — emitted once at import time.
# These checks run after Settings() so the final resolved values are used.
# ---------------------------------------------------------------------------

_DEV_JWT_SECRET = "dev-secret-change-me"
_DEV_ADMIN_PASSWORD = "changeme"


def _warn_insecure_defaults() -> None:
    """Emit loud warnings when security-critical settings hold dev defaults.

    When SECRETS_ENCRYPTION_KEY is empty, the Fernet key is derived from
    JWT_SECRET (see services/crypto.py).  If JWT_SECRET is still the published
    dev default, ALL stored API keys and portal passwords are effectively
    unprotected — the derivation is deterministic and publicly known.

    ADMIN_PASSWORD='changeme' gives unauthenticated admin access to anyone who
    reads this file or the public repository.

    These warnings are intentionally loud (WARNING level, repeated lines) so
    they appear in Railway / Heroku log streams even without a log aggregator.
    """
    if settings.JWT_SECRET == _DEV_JWT_SECRET and not settings.SECRETS_ENCRYPTION_KEY:
        _config_logger.warning(
            "SECURITE — JWT_SECRET est toujours la valeur par defaut de developpement "
            "('%s') ET SECRETS_ENCRYPTION_KEY est vide. "
            "Toutes les cles API et mots de passe de portails chiffres en base sont "
            "derives de cette valeur publiquement connue — equivalent a du texte clair. "
            "Definissez SECRETS_ENCRYPTION_KEY avec une cle Fernet dediee en production "
            "(python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"). "
            "Changer JWT_SECRET sans definir SECRETS_ENCRYPTION_KEY invalide silencieusement "
            "tous les secrets stockes.",
            _DEV_JWT_SECRET,
        )
        _config_logger.warning(
            "SECURITE — ACTION REQUISE : definissez SECRETS_ENCRYPTION_KEY en production."
        )

    if settings.JWT_SECRET == _DEV_JWT_SECRET:
        _config_logger.warning(
            "SECURITE — JWT_SECRET est toujours '%s'. "
            "Tous les tokens JWT emis sont signables par n'importe qui connaissant "
            "ce depot. Definissez JWT_SECRET avec une valeur aleatoire en production.",
            _DEV_JWT_SECRET,
        )

    if settings.ADMIN_PASSWORD == _DEV_ADMIN_PASSWORD:
        _config_logger.warning(
            "SECURITE — ADMIN_PASSWORD est toujours '%s'. "
            "Le compte administrateur est accessible avec un mot de passe public. "
            "Definissez ADMIN_PASSWORD avec un mot de passe fort en production.",
            _DEV_ADMIN_PASSWORD,
        )


_warn_insecure_defaults()

"""Application configuration loaded from environment variables.

Uses pydantic-settings (Pydantic v2). All values have dev-friendly defaults so
the app boots locally without a populated .env file.
"""

from urllib.parse import urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 720

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

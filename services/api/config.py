"""Application configuration loaded from environment variables.

Uses pydantic-settings (Pydantic v2). All values have dev-friendly defaults so
the app boots locally without a populated .env file.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database (SQLAlchemy 2.0 async / asyncpg)
    DATABASE_URL: str = "postgresql+asyncpg://openclaw:openclaw@localhost:5432/openclaw"

    # Auth / JWT
    JWT_SECRET: str = "dev-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 720

    # Single-admin login (credentials from env)
    ADMIN_EMAIL: str = "admin@btp.local"
    ADMIN_PASSWORD: str = "changeme"

    # Frontend origin (CORS)
    FRONTEND_ORIGIN: str = "http://localhost:3000"

    # LLM (Anthropic). Empty string => no client, agents return stubs.
    ANTHROPIC_API_KEY: str = ""
    OPENCLAW_MODEL: str = "claude-opus-4-8"


settings = Settings()

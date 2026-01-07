"""Gateway configuration settings."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration for the WhatsApp gateway."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Meta API
    META_VERIFY_TOKEN: str
    META_WHATSAPP_TOKEN: str
    META_PHONE_NUMBER_ID: str
    META_APP_SECRET: str
    FACEBOOK_USER_AGENT: str = "facebookexternalua"
    IN_META_SANDBOX_MODE: bool = False
    META_SANDBOX_PHONE_NUMBER: str = "11111111"
    MESSAGE_AGE_CUTOFF_IN_SECONDS: int = 3600

    # Engine connection
    ENGINE_BASE_URL: str  # e.g., "http://engine:8000"
    ENGINE_API_KEY: str  # ADMIN_API_TOKEN from engine

    # WhatsApp limits
    MAX_MESSAGE_LENGTH: int = 4096
    CHUNK_SIZE: int = 1500

    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_PSEUDONYM_SECRET: str = ""


config = Settings()  # type: ignore[call-arg]

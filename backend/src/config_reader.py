import json
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file='../.env',
        case_sensitive=False,
        extra='ignore'
    )

    fishjam_id: str
    fishjam_management_token: str
    google_api_key: str
    gemini_model: str

    prompts: dict[str, str] = {}


def load_settings() -> Settings:
    settings = Settings()
    prompts_path = Path(__file__).parent / "prompts.json"
    if prompts_path.exists():
        with open(prompts_path, "r", encoding="utf-8") as f:
            settings.prompts = json.load(f)
    return settings

"""
Configuration module.

Loads environment variables and defines constants used across the backend.
"""

import os
from dataclasses import dataclass
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # `.env.prod` takes priority over `.env`
        env_file='../.env',
        case_sensitive=False
    )

    fishjam_id: str
    fishjam_management_token: str
    google_api_key: str
    gemini_model: str


def load_settings() -> Settings:
    return Settings()

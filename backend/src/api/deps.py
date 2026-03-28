from fastapi import Request
from fishjam import FishjamClient
from google import genai

from src.config_reader import Settings

def get_settings(request: Request) -> Settings:
    return request.app.state.settings

def get_fishjam_client(request: Request) -> FishjamClient:
    return request.app.state.fishjam_client

def get_gemini_client(request: Request) -> genai.Client:
    return request.app.state.gemini_client

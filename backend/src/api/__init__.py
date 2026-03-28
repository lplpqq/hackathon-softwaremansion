import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fishjam import FishjamClient
from google import genai

from src.api.v1.analysis import router as analysis_router
from src.api.v1.sessions import router as sessions_router
from src.config_reader import load_settings

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = load_settings()
    fishjam_client = FishjamClient(
        fishjam_id=settings.fishjam_id,
        management_token=settings.fishjam_management_token,
    )
    gemini_client = genai.Client(api_key=settings.google_api_key)

    app.state.settings = settings
    app.state.fishjam_client = fishjam_client
    app.state.gemini_client = gemini_client
    
    yield

def create_app() -> FastAPI:
    app = FastAPI(title="Audio Analyzer Backend", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # tighten in production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include routers
    app.include_router(sessions_router, tags=["sessions"])
    app.include_router(analysis_router, tags=["analysis"])

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return app

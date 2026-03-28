import json
import logging
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Depends
from google import genai

from src.api.deps import get_settings, get_gemini_client
from src.config_reader import Settings
from src.parsers.news.bbc import get_bbc_article_info
from src.parsers.news.cnbc import get_cnbc_article_info
from src.parsers.social_media.youtube import get_youtube_video_info
from src.schemas.analysis import (
    CheckArticleRequest, CheckArticleResponse, CheckArticleChunk,
    CheckSourceRequest, CheckSourceResponse
)

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/check-article", response_model=CheckArticleResponse)
async def check_article(
    body: CheckArticleRequest, 
    settings: Settings = Depends(get_settings),
    client: genai.Client = Depends(get_gemini_client)
):
    url = body.url
    parsed_url = urlparse(url)
    domain = parsed_url.netloc
    logger.info(f"Checking the article: {url}")
    if domain.endswith("bbc.com"):
        article_data = get_bbc_article_info(url)
    elif domain.endswith("cnbc.com"):
        article_data = get_cnbc_article_info(url)
    else:
        raise HTTPException(status_code=400, detail="Unsupported article source!")

    system_instruction = settings.prompts["check_article"]
    system_instruction += f"\n{article_data.model_dump_json()}"

    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=body.model_dump_json(),
            config={
                "system_instruction": system_instruction,
                "temperature": 0.3,
                "response_mime_type": "application/json"
            }
        )
        parsed_json = json.loads(response.text)
        logger.info(parsed_json)

        return CheckArticleResponse(
            source_credibility_score=float(parsed_json["source_credibility_score"]),
            publisher_description=parsed_json["publisher_description"],
            short_text_analysis=parsed_json["short_text_analysis"],
            potential_manipulation_text_chunks=[
                CheckArticleChunk(
                    quote=chunk["quote"],
                    explanation=chunk["explanation"],
                ) for chunk in parsed_json["potential_manipulation_text_chunks"]
            ]
        )
    except Exception as e:
        logger.error("Gemini text query failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Gemini error: {e}")

@router.post("/check-video", response_model=CheckSourceResponse)
async def check_video(
    body: CheckSourceRequest, 
    settings: Settings = Depends(get_settings),
    client: genai.Client = Depends(get_gemini_client)
):
    video_url = body.url

    if "youtube.com/watch?v=" not in video_url:
        raise HTTPException(status_code=400, detail="Unsupported video source!")
    video_info = get_youtube_video_info(video_url)

    system_instruction = settings.prompts["check_video"]
    system_instruction += f"\n{video_info.model_dump_json()}"

    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=body.model_dump_json(),
            config={
                "system_instruction": system_instruction,
                "response_mime_type": "application/json"
            }
        )
        parsed_json = json.loads(response.text)
        logger.info(parsed_json)

        return CheckSourceResponse(
            source_credibility_score=float(parsed_json["source_credibility_score"]),
            title_provocativeness_description=parsed_json["title_provocativeness_description"]
        )
    except Exception as e:
        logger.error("Gemini text query failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Gemini error: {e}")

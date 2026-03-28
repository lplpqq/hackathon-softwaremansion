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

    system_instruction = ("You are professional lie/manipulation detector. "
                          "I found an online article, which I would like you to analyze for potential user misleadings. "
                          "I would like you to provide your assessment of this article based on its truthfullness and trustworthiness. "
                          "The input is as follows. "
                          "Firstly, source - the website where this article was published (e.g. bbc, cnbc). "
                          "You need to evaluate how well-known and reputable this website is. "
                          "Secondly, author - the person who wrote the report. You need to find the brief information about this person. "
                          "Lastly, text - the actual content of the story. "
                          "You  must evaluate the truthfulness of this article primarly based on it. "
                          "As a response I expect to receive a JSON string with next fields: "
                          "source_credibility_score - a float from 0 to 1 of how reputable the `source` website AND `author` is;"
                          "publisher_description - a laconic, 1 sentence max description of who the author of this article is and whether he/she is worth of trust;"
                          "short_text_analysis - the brief summary (1-2 sentences) of how manipulative/emotionfull/provoking the text is;"
                          "potential_manipulation_text_chunks - list of exact pieces of text from original article which are the most emotion-invoking/provocative/baitfull."
                          "The format of potential_manipulation_text_chunks is `quote` - the precise, 1-to-1 quote from the original text (no more than 2 sentences per chunk),"
                          "`explanation` - your 4-5 words explanation of why is this `quote` dangerous!")
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

    system_instruction = ("You are professional lie/manipulation detector. "
                          "I found an online video, which I would like you to analyze for potential user misleadings. "
                          "I would like you to provide your assessment of this article based on its trustworthiness. "
                          "The input is as follows. "
                          "Firstly, source - the website where this video was published (e.g. youtube, twitter). "
                          "You need to evaluate how well-known and reputable this website is. "
                          "Secondly, publisher - the person who published the video. You need to find the brief information about this person. "
                          "Lastly, title - the actual title of the video. "
                          "You  must evaluate the how clickbait this title is. "
                          "As a response I expect to receive a JSON string with next fields: "
                          "source_credibility_score - a float from 0 to 1 of how reputable the `source` website AND `publisher` is;"
                          "title_provocativeness_description - a short 1-2 description saying how much the title is provocative. use simple grammar english")
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

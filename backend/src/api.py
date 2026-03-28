import asyncio
import json
import logging
import uuid
from typing import Optional
from urllib.parse import urlparse

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fishjam import FishjamClient, PeerOptions
from google import genai
from pydantic import BaseModel

from agent import run_analysis_agent
from config_reader import Settings
from src.parsers.bbc import get_bbc_article_info
from src.parsers.cnbc import get_cnbc_article_info

logger = logging.getLogger(__name__)


class Session:
    """Tracks a running session (room + peer + agent task)."""

    def __init__(
        self,
        session_id: str,
        room_id: str,
        peer_token: str,
    ):
        self.session_id = session_id
        self.room_id = room_id
        self.peer_token = peer_token
        self.agent_task: Optional[asyncio.Task] = None
        self.websockets: list[WebSocket] = []

    async def broadcast_text(self, text: str) -> None:
        """Send a text chunk to all connected WebSocket clients."""
        dead: list[WebSocket] = []
        for ws in self.websockets:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.websockets.remove(ws)


_sessions: dict[str, Session] = {}

def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(title="Audio Analyzer Backend")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # tighten in production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    fishjam_client = FishjamClient(
        fishjam_id=settings.fishjam_id,
        management_token=settings.fishjam_management_token,
    )

    class CreateSessionResponse(BaseModel):
        session_id: str
        room_id: str
        peer_token: str
        ws_url: str


    # create room, peer, and start agent

    @app.post("/session", response_model=CreateSessionResponse)
    async def create_session():
        session_id = uuid.uuid4().hex[:12]

        # 1. Create a Fishjam room
        room = fishjam_client.create_room()
        logger.info("Created room %s", room.id)

        # 2. Create a peer for the Electron client
        peer, peer_token = fishjam_client.create_peer(
            room.id,
            options=PeerOptions(metadata={"role": "electron-client"}),
        )
        logger.info("Created peer %s in room %s", peer.id, room.id)

        # 3. Build the session object
        session = Session(
            session_id=session_id,
            room_id=room.id,
            peer_token=peer_token,
        )
        _sessions[session_id] = session

        # 4. Start the agent as a background task
        async def on_text(text: str) -> None:
            await session.broadcast_text(text)

        coro = run_analysis_agent(settings, room.id, on_text=on_text)

        session.agent_task = asyncio.create_task(
            coro, name=f"agent-{session_id}"
        )

        # Fire-and-forget error logging
        def _handle_agent_done(task: asyncio.Task) -> None:
            if task.cancelled():
                logger.info("Agent task %s cancelled", session_id)
            elif task.exception():
                logger.error(
                    "Agent task %s failed: %s",
                    session_id,
                    task.exception(),
                )

        session.agent_task.add_done_callback(_handle_agent_done)

        ws_url = f"/ws/analysis/{session_id}"
        return CreateSessionResponse(
            session_id=session_id,
            room_id=room.id,
            peer_token=peer_token,
            ws_url=ws_url,
        )

    # stream text analysis to frontend

    @app.websocket("/ws/analysis/{session_id}")
    async def analysis_websocket(websocket: WebSocket, session_id: str):
        session = _sessions.get(session_id)
        if not session:
            await websocket.close(code=404, reason="Session not found")
            return

        await websocket.accept()
        session.websockets.append(websocket)
        logger.info("WebSocket client connected to session %s", session_id)

        try:
            # Keep the connection alive; the agent pushes text via broadcast
            while True:
                # We can also receive messages from the frontend if needed
                # (e.g., commands to change analysis mode)
                data = await websocket.receive_text()
                logger.debug("Received from frontend: %s", data)
        except WebSocketDisconnect:
            logger.info("WebSocket client disconnected from session %s", session_id)
        finally:
            if websocket in session.websockets:
                session.websockets.remove(websocket)

    @app.delete("/session/{session_id}")
    async def delete_session(session_id: str):
        session = _sessions.pop(session_id, None)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Cancel the agent background task
        if session.agent_task and not session.agent_task.done():
            session.agent_task.cancel()

        # Close all WebSocket connections
        for ws in session.websockets:
            try:
                await ws.close()
            except Exception:
                pass

        logger.info("Session %s deleted", session_id)
        return {"status": "ok"}


    class CheckArticleRequest(BaseModel):
        url: str

    class CheckArticleChunk(BaseModel):
        quote: str
        explanation: str

    class CheckArticleResponse(BaseModel):
        source_credibility_score: float
        publisher_description: str
        short_text_analysis: str
        potential_manipulation_text_chunks: list[CheckArticleChunk]

    @app.post("/check-article", response_model=CheckArticleResponse)
    async def ask_gemini(body: CheckArticleRequest):
        url = body.url
        parsed_url = urlparse(url)
        domain = parsed_url.netloc
        if domain.endswith("bbc.com"):
            article_data = get_bbc_article_info(url)
        elif domain.endswith("cnbc.com"):
            article_data = get_cnbc_article_info(url)
        else:
            raise HTTPException(status_code=400, detail="Unsupported article source!")

        print(article_data)


        client = genai.Client(api_key=settings.google_api_key)
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
                # config=GenerateContentConfigOrDict(
                #     system_instruction=system_instruction,
                #     temperature=0.3
                # )
            )
            parsed_json = json.loads(response.text)
            print(parsed_json)

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

    return app


import asyncio
import logging
import uuid
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.genai.types import GenerateContentConfigOrDict
from pydantic import BaseModel, Field

from fishjam import FishjamClient, PeerOptions, AgentOptions
from fishjam.integrations.gemini import GeminiIntegration

from .config_reader import Settings
from .agent import run_analysis_agent

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
            await websocket.close(code=4004, reason="Session not found")
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

    class CheckArticleResponse(BaseModel):
        source_credibility_score: float
        publisher_description: str


    @app.post("/check-article", response_model=CheckArticleResponse)
    async def ask_gemini(body: CheckArticleRequest):
        from google import genai

        client = genai.Client(api_key=settings.google_api_key)
        system_instruction = "I am watching an online video right now which I found on the internet and I would like you to analyze based on how factual and trustworthy the information in it is. The input is as follows. Firstly, source - the website where this video is being played from (e.g. youtube, twitter, reddit). You need to evaluate how well-known and reputable this website is for looking for factual information. Secondly, publisher - the person who published the video (e.g. youtube channel name, twitter username). You need to find the brief information about this person/group if there is any. As a response I expect to receive a JSON string with next fields: source_credibility_score - a float from 0 to 1 of how reputable the `source` website is; publisher_description - a laconic, 1 sentence description of who the publisher of this article is and whether he/she is worth of trust for factual information."
        try:
            # response = await client.aio.models.generate_content(
            #     model="gemini-2.5-flash",
            #     contents=body.model_dump_json(),
            #     config={
            #         "system_instruction": system_instruction,
            #         "temperature": 0.3
            #     }
            #     # config=GenerateContentConfigOrDict(
            #     #     system_instruction=system_instruction,
            #     #     temperature=0.3
            #     # )
            # )
            # print(response.text)

            return CheckArticleResponse(source_credibility_score=0.1, publisher_description="hey")
        except Exception as e:
            logger.error("Gemini text query failed: %s", e)
            raise HTTPException(status_code=502, detail=f"Gemini error: {e}")

    return app

    return app

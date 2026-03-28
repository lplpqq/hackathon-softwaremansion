import asyncio
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fishjam import FishjamClient, PeerOptions

from google import genai

from src.agent import run_analysis_agent
from src.api.deps import get_settings, get_fishjam_client, get_gemini_client
from src.config_reader import Settings
from src.schemas.sessions import CreateSessionResponse
from src.services.session_manager import _sessions, Session

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/create-session", response_model=CreateSessionResponse)
async def create_session(
    settings: Settings = Depends(get_settings),
    fishjam_client: FishjamClient = Depends(get_fishjam_client),
    gemini_client: genai.Client = Depends(get_gemini_client)
):
    session_id = uuid.uuid4().hex[:12]

    room = fishjam_client.create_room()
    logger.info("Created room %s", room.id)

    # 2. Create a peer for the Electron client
    peer, peer_token = fishjam_client.create_peer(
        room.id,
        options=PeerOptions(metadata={"role": "electron-client"}),
    )
    logger.info(f"Created peer {peer.id} in room {room.id}")

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

    coro = run_analysis_agent(settings, fishjam_client, gemini_client, room.id, on_text=on_text)

    session.agent_task = asyncio.create_task(
        coro, name=f"agent-{session_id}"
    )

    # Fire-and-forget error logging
    def _handle_agent_done(task: asyncio.Task) -> None:
        if task.cancelled():
            logger.info(f"Agent task {session_id} cancelled")
        elif task.exception():
            logger.error(f"Agent task {session_id} failed: {task.exception()}")

    session.agent_task.add_done_callback(_handle_agent_done)

    ws_url = f"/ws/analysis/{session_id}"
    return CreateSessionResponse(
        session_id=session_id,
        room_id=room.id,
        peer_token=peer_token,
        ws_url=ws_url,
    )

@router.websocket("/ws/analysis/{session_id}")
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
            logger.debug(f"Received from frontend: {data}")
    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected from session {session_id}")
    finally:
        if websocket in session.websockets:
            session.websockets.remove(websocket)

@router.delete("/session/{session_id}")
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

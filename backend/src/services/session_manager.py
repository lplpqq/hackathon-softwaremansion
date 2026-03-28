import asyncio
import logging
from typing import Optional

from fastapi import WebSocket

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

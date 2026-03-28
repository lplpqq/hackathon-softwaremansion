from pydantic import BaseModel

class CreateSessionResponse(BaseModel):
    session_id: str
    room_id: str
    peer_token: str
    ws_url: str

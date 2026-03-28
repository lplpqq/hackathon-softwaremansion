from enum import StrEnum, auto

from pydantic import BaseModel


class VideoOrigin(StrEnum):
    YOUTUBE = auto()


class VideoInfo(BaseModel):
    source: VideoOrigin
    publisher: str
    title: str

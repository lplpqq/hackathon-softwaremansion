from pydantic import BaseModel
from enum import StrEnum, auto


class ArticleOrigin(StrEnum):
    BBC = auto()
    CNBC = auto()


class ArticleInfo(BaseModel):
    source: ArticleOrigin
    author: str
    text: str

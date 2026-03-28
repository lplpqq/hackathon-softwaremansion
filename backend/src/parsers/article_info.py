from enum import StrEnum, auto

from pydantic import BaseModel


class ArticleOrigin(StrEnum):
    BBC = auto()
    CNBC = auto()


class ArticleInfo(BaseModel):
    source: ArticleOrigin
    author: str
    text: str

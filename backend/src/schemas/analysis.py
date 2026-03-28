from pydantic import BaseModel

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

class CheckSourceRequest(BaseModel):
    url: str

class CheckSourceResponse(BaseModel):
    source_credibility_score: float
    title_provocativeness_description: str

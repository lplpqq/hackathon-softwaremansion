import json
import re

import requests
from bs4 import BeautifulSoup

from parsers.article_info import ArticleInfo, ArticleOrigin


def get_cnbc_article_info(url: str) -> ArticleInfo:
    response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'})
    # print(res.text)
    text_match = re.search("articleBodyText\":\"(.*?)\",", response.text)
    text = ""
    if text_match is not None:
        text = text_match.group(1)

    soup = BeautifulSoup(response.text, 'lxml')
    author_element = soup.find("meta", attrs={"name": "author"})
    author_name = author_element.get("content")

    return ArticleInfo(
        source=ArticleOrigin.CNBC,
        author=author_name,
        text=text,
    )

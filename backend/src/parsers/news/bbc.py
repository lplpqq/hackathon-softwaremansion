import json

import requests
from bs4 import BeautifulSoup

from src.parsers.news.article_info import ArticleInfo, ArticleOrigin


def get_bbc_article_info(url: str) -> ArticleInfo:
    res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'})
    soup = BeautifulSoup(res.text, 'lxml')

    data = soup.find('script', attrs={'id': '__NEXT_DATA__'}).get_text()
    json_data = json.loads(data)
    main_data = json_data['props']['pageProps']
    metadata = main_data['metadata']
    # title = metadata['seoHeadline']
    author = metadata['contributor']
    page_content = main_data['page']

    text_blocks = []

    for k, v in page_content.items():
        if isinstance(v, dict):
            for content in v['contents']:
                if content['type'] == 'text':
                    for block in content['model']['blocks']:
                        if block['type'] == 'paragraph':
                            block_text = block['model']['text']
                            text_blocks.append(block_text)

    return ArticleInfo(
        source=ArticleOrigin.BBC,
        author=author,
        text='\n'.join(text_blocks),
    )

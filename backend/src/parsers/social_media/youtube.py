import requests
from bs4 import BeautifulSoup

from src.parsers.social_media.video_info import VideoInfo, VideoOrigin


def get_youtube_video_info(url: str) -> VideoInfo:
    response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'})
    soup = BeautifulSoup(response.content, 'lxml')
    author_element = soup.find('span', attrs={'itemprop': 'author'})
    publisher_name = author_element.find('link', attrs={'itemprop': 'name'}).get('content')
    video_title = soup.find('title').get_text()

    return VideoInfo(
        source=VideoOrigin.YOUTUBE,
        publisher=publisher_name,
        title=video_title,
    )

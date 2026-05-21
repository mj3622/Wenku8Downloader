"""
api_server.py - FastAPI 本地服务

封装 Book、Crawler、Downloader、ConfigManager 为 REST API，
供 Electron 前端通过 localhost 调用。
"""

from contextlib import contextmanager
import logging
import threading
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from .book import Book
from .config_manager import config
from .crawler import crawler
from .downloader import Downloader

logger = logging.getLogger(__name__)

app = FastAPI(title="Wenku8Downloader API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

downloader = Downloader()


# ------------------------------------------------------------------
# 无 Streamlit 环境的进度模拟
# ------------------------------------------------------------------

class NoOpProgress:
    """模拟 Streamlit progress 的占位对象，用于非 Streamlit 环境。"""

    def progress(self, value: float, text: str = ""):
        pass


class NoOpContainer:
    """模拟 Streamlit container 的占位对象。"""

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def progress(self, value: float, text: str = ""):
        return NoOpProgress()

    def spinner(self, text: str = ""):
        return contextmanager(lambda: (yield))()

    @staticmethod
    def write(*args, **kwargs):
        pass

    @staticmethod
    def success(*args, **kwargs):
        pass

    @staticmethod
    def error(*args, **kwargs):
        pass

    @staticmethod
    def caption(*args, **kwargs):
        pass

    @staticmethod
    def divider(*args, **kwargs):
        pass

    @staticmethod
    def image(*args, **kwargs):
        pass


# ------------------------------------------------------------------
# 请求/响应模型
# ------------------------------------------------------------------

class ConfigUpdate(BaseModel):
    section: str
    key: str
    value: str

class DownloadEpubRequest(BaseModel):
    book_id: str
    volume_name: Optional[str] = None

class DownloadImagesRequest(BaseModel):
    book_id: str
    volume_name: Optional[str] = None


# ------------------------------------------------------------------
# 配置
# ------------------------------------------------------------------

@app.get("/api/config")
def get_config():
    return config.get_all()


@app.post("/api/config")
def set_config(body: ConfigUpdate):
    config.set(body.section, body.key, body.value)
    # 同步更新内存中的 crawler
    _sync_crawler_config(body.section, body.key, body.value)
    return {"status": "ok"}


# ------------------------------------------------------------------
# Cookie
# ------------------------------------------------------------------

@app.post("/api/cookie/auto")
def auto_get_cookie():
    try:
        crawler.get_cookie_via_browser()
        return {"status": "ok", "message": "Cookie 自动获取成功"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------
# 搜索
# ------------------------------------------------------------------

@app.get("/api/search/author")
def search_author(q: str = Query(..., min_length=1)):
    try:
        results = crawler.search(q, "author")
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/search/title")
def search_title(q: str = Query(..., min_length=1)):
    try:
        results = crawler.search(q, "articlename")
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------
# 书籍信息
# ------------------------------------------------------------------

@app.get("/api/book/{book_id}")
def get_book_info(book_id: str):
    try:
        book = Book(book_id, crawler=crawler)
        return {
            "book_id": book.book_id,
            "basic_info": book.basic_info,
            "volumes": {
                k: [{"name": ch["name"], "link": ch["link"]} for ch in v]
                for k, v in book.volumes.items()
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/book/{book_id}/images")
def get_book_images(book_id: str):
    try:
        book = Book(book_id, crawler=crawler)
        return {"images": book.picture_urls}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------
# 下载
# ------------------------------------------------------------------

@app.post("/api/download/epub")
def download_epub(body: DownloadEpubRequest):
    try:
        book = Book(body.book_id, crawler=crawler)
        downloader.download_novel(book, NoOpContainer(), body.volume_name)
        return {"status": "ok", "message": "下载完成"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/download/images")
def download_images(body: DownloadImagesRequest):
    try:
        book = Book(body.book_id, crawler=crawler)
        if body.volume_name:
            urls = book.get_chapter_image_urls(volume_name=body.volume_name)
            downloader.download_pictures(
                urls, body.volume_name, book.basic_info["标题"], NoOpContainer()
            )
        else:
            for volume in book.picture_urls:
                urls = book.get_chapter_image_urls(volume)
                downloader.download_pictures(
                    urls, volume, book.basic_info["标题"], NoOpContainer()
                )
        return {"status": "ok", "message": "下载完成"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------
# 辅助
# ------------------------------------------------------------------

def _sync_crawler_config(section: str, key: str, value: str):
    """将配置变更同步到内存中的 crawler 实例。"""
    if section == "proxy":
        crawler.proxies = None
    elif section == "cookie":
        crawler.cookies.update({key: value})


# ------------------------------------------------------------------
# 入口
# ------------------------------------------------------------------

def start_server(port: int = 0):
    """启动 API 服务。port=0 时自动分配可用端口。"""
    import socket

    if port == 0:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]

    def run():
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return port


if __name__ == "__main__":
    port = start_server(52525)
    print(f"API server running at http://127.0.0.1:{port}")
    import time

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("Server stopped")

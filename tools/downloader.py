"""
downloader.py - 文件下载模块

提供两类下载功能：
  - download_pictures：将指定卷的所有插图保存为本地图片文件
  - download_novel  ：将整本或指定卷的小说内容打包为 EPUB 电子书

下载结果默认保存到项目根目录下的 downloads/ 文件夹：
  downloads/
    pics/    # 图片下载目录
    novels/  # EPUB 下载目录
"""

import os
from typing import List, Union
import time

import streamlit as st
from ebooklib import epub

from .config_manager import ConfigManager
from .crawler import WebCrawler

# ------------------------------------------------------------------
# 下载目录常量
# ------------------------------------------------------------------
SAVE_PATH = os.path.join(os.getcwd(), "downloads")
PIC_PATH = os.path.join(SAVE_PATH, "pics")
NOVEL_PATH = os.path.join(SAVE_PATH, "novels")

# 模块级单例：避免 Downloader 与 Book 各自创建多个 WebCrawler 实例
_crawler = WebCrawler()
_config = ConfigManager()


class Downloader:
    """
    下载器，负责将小说内容保存到本地。

    实例化时自动创建所需的目录结构（downloads/pics 和 downloads/novels）。
    """

    def __init__(self):
        """初始化下载器，确保输出目录已存在。"""
        for directory in (SAVE_PATH, PIC_PATH, NOVEL_PATH):
            os.makedirs(directory, exist_ok=True)

    # ------------------------------------------------------------------
    # 公开方法
    # ------------------------------------------------------------------

    def download_pictures(
        self,
        urls: List[str],
        volume_name: str,
        novel_name: str,
        progress_container,
        index: Union[int, str] = "",
    ) -> None:
        """
        下载指定卷的所有插图，并保存到本地目录。

        保存路径规则：
          - 未指定 index：downloads/pics/<novel_name>/<volume_name>/
          - 指定 index  ：downloads/pics/<novel_name>/<index>_<volume_name>/
            （用于「全部下载」时按顺序区分各卷）

        :param urls: 图片 URL 列表
        :param volume_name: 卷名，用于命名子目录
        :param novel_name: 书名，用于命名父目录
        :param progress_container: Streamlit 容器，用于显示进度条
        :param index: 可选，下载顺序编号；非空时作为目录前缀
        """
        # 构造保存路径
        if index != "":
            volume_path = os.path.join(PIC_PATH, novel_name, f"{index}_{volume_name}")
        else:
            volume_path = os.path.join(PIC_PATH, novel_name, volume_name)
        os.makedirs(volume_path, exist_ok=True)

        total = len(urls)
        with progress_container:
            bar = st.progress(0)
            for i, url in enumerate(urls):
                bar.progress(
                    i / total,
                    f"⏬ 正在下载 {volume_name} 第 {i + 1}/{total} 张图片...",
                )
                suffix = url.rsplit(".", 1)[-1]
                content = _crawler.get_image_content(url)
                if content:
                    file_path = os.path.join(volume_path, f"{i + 1}.{suffix}")
                    with open(file_path, "wb") as f:
                        f.write(content)
                    time.sleep(0.2)   # 下载间隔，避免触发反爬
            bar.progress(1.0, "✅ 下载完成")

    def download_novel(
        self,
        book,
        progress_container,
        volume_name: str = None,
    ) -> None:
        """
        将小说下载并打包为 EPUB 电子书。

        - 指定 volume_name：下载单卷，保存为
          downloads/novels/<book_name>/<volume_name>.epub
        - 不指定 volume_name：下载整本，保存为
          downloads/novels/<book_title>.epub

        :param book: Book 实例
        :param progress_container: Streamlit 容器，用于显示进度条
        :param volume_name: 要下载的卷名；None 表示下载整本
        """
        ebook = epub.EpubBook()
        ebook.set_language("zh")
        ebook.add_author(book.basic_info["作者"])

        with progress_container:
            if volume_name:
                self._download_single_volume(ebook, book, volume_name)
            else:
                self._download_full_book(ebook, book)

    # ------------------------------------------------------------------
    # 私有辅助方法
    # ------------------------------------------------------------------

    def _download_single_volume(self, ebook: epub.EpubBook, book, volume_name: str) -> None:
        """
        下载并打包单卷内容为 EPUB。

        :param ebook: 已初始化的 EpubBook 对象
        :param book: Book 实例
        :param volume_name: 目标卷名
        """
        volume = book.volumes[volume_name]
        book_name = book.get_formatted_title(_config.get("download", "full_title"))
        ebook.set_title(f"{book_name} {volume_name}")

        chapters = []
        bar = st.progress(0)
        total_items = len(volume)

        for item_idx, item in enumerate(volume):
            name = item["name"]
            link = f'{book.base_chapter_url}{item["link"]}'
            chapter = epub.EpubHtml(title=name, file_name=f"{name}.xhtml", lang="zh")

            if name == "插图":
                # 下载该卷所有插图并内嵌到 EPUB
                chapter.content = self._embed_images(
                    ebook, book, volume_name, set_cover=True
                )
            else:
                # 下载章节正文
                text_div = _crawler.fetch(link).find("div", id="content")
                for ul_tag in text_div.find_all("ul"):
                    ul_tag.decompose()  # 移除页面导航列表
                chapter.content = f"<html><h2>{name}</h2><body>{text_div}</body></html>"
                bar.progress(
                    item_idx / total_items,
                    f"⏬ 正在下载 {volume_name} 第 {item_idx + 1}/{total_items} 章节...",
                )

            ebook.add_item(chapter)
            chapters.append(chapter)
            ebook.toc.append(epub.Link(f"{name}.xhtml", name, name))

        # 写入 EPUB 文件
        ebook.spine = ["nav"] + chapters
        ebook.add_item(epub.EpubNav())
        save_dir = os.path.join(NOVEL_PATH, book_name)
        os.makedirs(save_dir, exist_ok=True)
        epub.write_epub(os.path.join(save_dir, f"{volume_name}.epub"), ebook, {})

        bar.progress(1.0, f"✅ {book_name} {volume_name} 下载完成")
        st.success(f"小说 {book_name}《{volume_name}》下载完成")

    def _download_full_book(self, ebook: epub.EpubBook, book) -> None:
        """
        下载整本小说（所有卷）并打包为单个 EPUB。

        :param ebook: 已初始化的 EpubBook 对象
        :param book: Book 实例
        """
        book_title = book.get_formatted_title(_config.get("download", "full_title"))
        ebook.set_title(book_title)

        # 下载并设置封面
        with st.spinner("正在下载封面..."):
            cover_filename = book.basic_info["cover"].rsplit("/", 1)[-1]
            ebook.set_cover(cover_filename, book.get_cover_content())

        chapters = []

        for volume_name, volume in book.volumes.items():
            # 每卷对应 EPUB 中的一个章节文件，将所有卷内容拼入同一 xhtml
            chapter = epub.EpubHtml(
                title=volume_name,
                file_name=f"{volume_name}.xhtml",
                lang="zh",
            )
            html_parts = [f"<img src=images/{volume_name}_1.jpg>"]   # 卷首图占位
            bar = st.progress(0)
            img_bar = st.progress(0)
            total_items = len(volume)

            for item_idx, item in enumerate(volume):
                bar.progress(
                    item_idx / total_items,
                    f"⏬ 正在下载 {volume_name} 第 {item_idx + 1}/{total_items} 章节...",
                )
                name = item["name"]
                link = f'{book.base_chapter_url}{item["link"]}'

                if name == "插图":
                    # 下载插图并内嵌到 EPUB
                    ch_urls = book.get_chapter_image_urls(volume_name)
                    total_pics = len(ch_urls)
                    for pic_idx, url in enumerate(ch_urls):
                        img_bar.progress(
                            pic_idx / total_pics,
                            f"⏬ 正在下载 {volume_name} 第 {pic_idx + 1}/{total_pics} 张图片...",
                        )
                        suffix = url.rsplit(".", 1)[-1]
                        content = _crawler.get_image_content(url)
                        if content:
                            img_name = f"images/{volume_name}_{pic_idx + 1}.{suffix}"
                            ebook.add_item(epub.EpubItem(
                                file_name=img_name,
                                media_type="image/jpeg",
                                content=content,
                            ))
                            html_parts.append(f'<img src="{img_name}">')
                            time.sleep(0.2)
                    html_parts.append("<br>")
                    img_bar.progress(1.0, f"✅ {volume_name} 图片下载完成")
                else:
                    # 下载正文
                    text_div = _crawler.fetch(link).find("div", id="content")
                    for ul_tag in text_div.find_all("ul"):
                        ul_tag.decompose()
                    html_parts.append(f"<h2>{name}</h2><body>{text_div}</body><br>")

            chapter.content = f"<html>{''.join(html_parts)}</html>"
            ebook.add_item(chapter)
            chapters.append(chapter)
            ebook.toc.append(epub.Link(f"{volume_name}.xhtml", volume_name, volume_name))
            bar.progress(1.0, f"✅ {volume_name} 下载完成")

        ebook.spine = ["nav"] + chapters
        ebook.add_item(epub.EpubNav())
        epub.write_epub(os.path.join(NOVEL_PATH, f"{book_title}.epub"), ebook, {})
        st.success(f"小说《{book_title}》整本下载完成")

    def _embed_images(
        self,
        ebook: epub.EpubBook,
        book,
        volume_name: str,
        set_cover: bool = False,
    ) -> str:
        """
        将指定卷的所有插图内嵌到 EPUB，并返回对应的 HTML 字符串。

        :param ebook: 目标 EpubBook 对象
        :param book: Book 实例
        :param volume_name: 卷名
        :param set_cover: 为 True 时，将封面索引对应的图片设为 EPUB 封面
        :return: 包含所有 <img> 标签的 HTML 字符串
        """
        ch_urls = book.get_chapter_image_urls(volume_name)
        cover_index = _config.get("download", "default_cover_index")
        pic_bar = st.progress(0)
        total = len(ch_urls)
        html_parts = []

        for pic_idx, url in enumerate(ch_urls):
            pic_bar.progress(
                pic_idx / total,
                f"⏬ 正在下载 {volume_name} 第 {pic_idx + 1}/{total} 张图片...",
            )
            suffix = url.rsplit(".", 1)[-1]
            content = _crawler.get_image_content(url)
            if content:
                img_name = f"images/{volume_name}_{pic_idx + 1}.{suffix}"
                ebook.add_item(epub.EpubItem(
                    file_name=img_name,
                    media_type="image/jpeg",
                    content=content,
                ))
                html_parts.append(f'<img src="{img_name}">')

                # 将指定索引的图片设为封面
                if set_cover and pic_idx == cover_index:
                    ebook.set_cover(f"{volume_name}/cover.{suffix}", content)

                time.sleep(0.2)

        pic_bar.progress(1.0, f"✅ {volume_name} 图片下载完成")
        return "".join(html_parts)

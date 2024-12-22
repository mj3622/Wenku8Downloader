import os
import time
import streamlit as st

from ebooklib import epub
from .crawler import WebCrawler

SAVE_PATH = os.path.join(os.getcwd(), 'downloads')
PIC_PATH = os.path.join(SAVE_PATH, 'pics')
NOVEL_PATH = os.path.join(SAVE_PATH, 'novels')

crawler = WebCrawler()


class Downloader:
    def __init__(self):
        if not os.path.exists(SAVE_PATH):
            os.makedirs(SAVE_PATH)
        if not os.path.exists(PIC_PATH):
            os.makedirs(PIC_PATH)
        if not os.path.exists(NOVEL_PATH):
            os.makedirs(NOVEL_PATH)

    def download_pictures(self, urls, volume_name, novel_name, progress_container, cnt=''):
        """下载指定卷的所有图片"""
        volume_path = os.path.join(PIC_PATH, novel_name, volume_name)
        if cnt != '':
            volume_path = os.path.join(PIC_PATH, novel_name, f"{cnt}_{volume_name}")
        if not os.path.exists(volume_path):
            os.makedirs(volume_path)

        with progress_container:
            bar = st.progress(0)
            for i, url in enumerate(urls):
                bar.progress(i / len(urls), f"⏬ 正在下载 {volume_name} 第{i + 1}/{len(urls)}张图片...")
                suffix = url.split('.')[-1]

                content = crawler.get_image_content(url)
                if content:
                    file_path = f"{volume_path}/{i + 1}.{suffix}"
                    with open(file_path, 'wb') as f:
                        f.write(content)
                    time.sleep(0.2)

            bar.progress(1.0, "✅ 下载完成")

    def download_novel(self, book, progress_container, volume_name=None):
        ebook = epub.EpubBook()
        ebook.set_language('zh')
        ebook.add_author(book.basic_info['作者'])
        chapters = []
        with progress_container:
            if volume_name:
                # TODO 下载某一卷
                pass
            else:
                with st.spinner(f"正在下载封面..."):
                    # 下载整本小说
                    ebook.set_title(book.basic_info['标题'])

                    # 获取小说封面
                    cover_name = book.basic_info['cover'].split('/')[-1]
                    cover_content = book.get_cover_content()
                    ebook.set_cover(cover_name, cover_content)


                # 循环下载每一卷
                for volume_name, volume in book.volumes.items():
                    chapter = epub.EpubHtml(title=volume_name, file_name=f'{volume_name}.xhtml', lang='zh')
                    text = f'<img src=images/{volume_name}_1.jpg>'
                    bar = st.progress(0)
                    img_bar = st.progress(0)
                    for item in volume:
                        bar.progress(volume.index(item) / len(volume), f"⏬ 正在下载 {volume_name} 第{volume.index(item) + 1}/{len(volume)}章节...")
                        name = item['name']
                        link = f'{book.base_chapter_url}{item["link"]}'
                        if name == '插图':
                            ch_urls = book.get_chapter_image_urls(volume_name)
                            for url in ch_urls:
                                img_bar.progress(ch_urls.index(url) / len(ch_urls), f"⏬ 正在下载 {volume_name} 第{ch_urls.index(url) + 1}/{len(ch_urls)}张图片...")
                                suffix = url.split('.')[-1]
                                content = crawler.get_image_content(url)
                                if content:
                                    img_name = f'images/{volume_name}_{ch_urls.index(url) + 1}.{suffix}'
                                    ebook.add_item(
                                        epub.EpubItem(file_name=img_name, media_type='image/jpeg', content=content))
                                    text += f'<img src="{img_name}">'
                                    time.sleep(0.2)
                            text += '<br>'
                            img_bar.progress(1.0, f'✅ {volume_name} 图片下载完成')
                        else:
                            # 处理文本
                            content = crawler.fetch(link).find('div', id='content')
                            for ul_tag in content.find_all('ul'):
                                ul_tag.decompose()
                            text += f'<h2>{name}</h2><body>{content}</body><br>'
                    chapter.content = f'<html>{text}</html>'
                    ebook.add_item(chapter)
                    chapters.append(chapter)
                    ebook.toc.append(epub.Link(f'{volume_name}.xhtml', volume_name, volume_name))
                    bar.progress(1.0, f'✅ {volume_name} 下载完成')

                ebook.spine = ['nav'] + chapters
                ebook.add_item(epub.EpubNav())
                path = os.path.join(NOVEL_PATH, f'{book.basic_info["标题"]}.epub')
                epub.write_epub(path, ebook, {})

"""
book.py - 小说数据模型模块

定义 Book 类，负责从轻小说文库（wenku8.net）抓取并封装一部小说的完整信息：
  - 基本信息（标题、作者、状态、简介、封面等）
  - 章节目录（按卷分组）
  - 插图链接
  - 标题格式化工具
"""

import re
from typing import List, Optional

from .crawler import WebCrawler


class Book:
    """
    代表轻小说文库中的一部小说。

    实例化时会自动抓取该书的章节目录与基本信息，
    后续可通过各方法获取插图链接、封面内容等。
    """

    def __init__(self, book_id: str, crawler: WebCrawler = None):
        """
        初始化 Book 对象，自动拉取书籍数据。

        :param book_id: 书籍在文库中的数字编号，如 "3057"
        :param crawler: 可选，外部传入的 WebCrawler 实例；
                        若为 None，则在内部创建一个新实例
        """
        self.my_crawler = crawler if crawler is not None else WebCrawler()
        self.book_id = book_id

        # 按顺序初始化：章节目录 → 插图 URL 映射 → 基本信息
        self.base_chapter_url, self.volumes = self._fetch_chapters()
        self.volume_num = len(self.volumes)
        self.picture_urls = self._build_picture_url_map()
        self.basic_info = self._fetch_basic_info()

    # ------------------------------------------------------------------
    # 初始化阶段的私有抓取方法
    # ------------------------------------------------------------------

    def _fetch_chapters(self) -> tuple[str, dict]:
        """
        抓取小说的章节目录，并按卷分组。

        访问书籍详情页，找到「小说目录」链接，
        再抓取目录页，将章节解析为以卷名为键的有序字典。

        :return: (base_chapter_url, volumes) 元组
                 - base_chapter_url: 章节页的公共前缀 URL
                 - volumes: OrderedDict，键为卷名，值为章节列表
                            每个章节格式：{"name": str, "link": str}
        :raises Exception: 若找不到目录链接则抛出
        """
        book_page_url = f"https://www.wenku8.net/book/{self.book_id}.htm"
        soup = self.my_crawler.fetch(book_page_url)

        # 在详情页中找到「小说目录」的链接
        chapter_index_url = "https://www.wenku8.net"
        for a in soup.find("div", id="content").find("div").find_all("a"):
            if a.text == "小说目录":
                chapter_index_url += a["href"]
                break
        else:
            raise Exception(f"未找到小说目录链接，书籍编号：{self.book_id}")

        # 抓取目录页，解析卷和章节
        rows = (
            self.my_crawler.fetch(chapter_index_url)
            .find("table", class_="css")
            .find_all("tr")
        )

        volumes = {}
        current_volume = None

        for row in rows:
            # 检测卷标题行
            volume_tag = row.find("td", class_="vcss")
            if volume_tag:
                current_volume = volume_tag.get_text().strip()
                volumes[current_volume] = []
                continue

            # 检测章节行：提取所有带 href 的 <a> 标签
            link_tags = row.find_all("a", href=True)
            if link_tags and current_volume is not None:
                for tag in link_tags:
                    volumes[current_volume].append({
                        "name": tag.get_text().strip(),
                        "link": tag["href"],
                    })

        # 构建章节页的公共前缀（去掉 index.htm）
        base_chapter_url = chapter_index_url.replace("index.htm", "")
        return base_chapter_url, volumes

    def _build_picture_url_map(self) -> dict:
        """
        从章节目录中提取每一卷「插图」章节的链接，构建插图 URL 映射。

        :return: 字典，键为卷名，值为该卷插图章节的相对路径
                 如 {"第一卷": "125425.htm"}
        """
        picture_map = {}
        for volume_name, chapters in self.volumes.items():
            for chapter in chapters:
                if chapter["name"] == "插图":
                    picture_map[volume_name] = chapter["link"]
        return picture_map

    def _fetch_basic_info(self) -> dict:
        """
        抓取书籍详情页，解析基本信息并以字典形式返回。

        :return: 包含以下键的字典：
                 标题、作者、出版社、最新章节、连载状态、
                 更新时间、全文长度、简介、cover（封面 URL）
        """
        url = f"https://www.wenku8.net/book/{self.book_id}.htm"
        soup = self.my_crawler.fetch(url)
        content_div = soup.find("div", id="content")
        info_table = content_div.find("table")

        # 书名
        title = info_table.find("b").text

        # 基本属性（分类、作者、状态、更新时间、字数）
        info_cells = info_table.find_all("tr")[2].find_all("td")
        category = info_cells[0].text.split("：")[1]
        author = info_cells[1].text.split("：")[1]
        status = info_cells[2].text.split("：")[1]
        update_time = info_cells[3].text.split("：")[1] if len(info_cells) > 3 else None
        length = info_cells[4].text.split("：")[1] if len(info_cells) > 4 else None

        # 最新章节（部分书籍可能缺少该字段）
        try:
            latest_table = content_div.find("div").find_all("table")[2]
            latest_chapter = latest_table.find("a").get_text(strip=True)
        except Exception:
            latest_chapter = None

        # 简介（取最后一个 <span> 的文本）
        description = content_div.find_all("span")[-1].get_text()

        # 封面图（页面第二张 <img>，第一张是站点 Logo）
        img_urls = [img["src"] for img in soup.find_all("img") if "src" in img.attrs]
        cover = img_urls[1] if len(img_urls) > 1 else None

        return {
            "标题": title,
            "作者": author,
            "出版社": category,
            "最新章节": latest_chapter,
            "连载状态": status,
            "更新时间": update_time,
            "全文长度": length,
            "简介": description,
            "cover": cover,
        }

    # ------------------------------------------------------------------
    # 公开方法
    # ------------------------------------------------------------------

    def get_chapter_image_urls(self, volume_name: str = None) -> Optional[List[str]]:
        """
        获取指定卷插图章节页中所有图片的完整 URL。

        :param volume_name: 卷名；若为 None 或该卷无插图，则返回 None
        :return: 图片 URL 字符串列表，例如
                 ["https://pic.xxx.xyz/3/3057/125425/165682.jpg", ...]
        """
        if not volume_name or volume_name not in self.picture_urls:
            return None

        page_url = f"{self.base_chapter_url}{self.picture_urls[volume_name]}"
        img_tags = self.my_crawler.fetch(page_url).find_all("img")
        return [img["src"] for img in img_tags if "src" in img.attrs]

    def get_cover_content(self) -> bytes:
        """
        下载封面图片并返回原始二进制内容。

        :return: 封面图片的 bytes 内容
        """
        return self.my_crawler.fetch(self.basic_info["cover"], parse=False)

    def get_formatted_title(self, fmt: str) -> str:
        """
        根据指定格式返回书名。

        书名若包含括号（如"败北女角太多了！(败犬女主太多了！)"），
        可选择保留全名、仅保留括号外，或仅保留括号内。

        :param fmt: 格式代码，可选值：
                    - "FULL"：完整书名
                    - "OUT" ：括号外部分，如 "败北女角太多了！"
                    - "IN"  ：括号内部分，如 "败犬女主太多了！"
        :return: 格式化后的书名字符串；
                 若格式无法匹配（书名无括号时选 OUT/IN），返回原书名
        """
        title = self.basic_info["标题"]
        if fmt == "FULL":
            return title

        match = re.match(r"^(.*?)\((.*?)\)$", title)
        if match:
            if fmt == "OUT":
                return match.group(1)
            if fmt == "IN":
                return match.group(2)

        # 无法按格式解析时，回退到完整书名
        return title

import re

from . import crawler


class Book:
    def __init__(self, book_id):
        self.my_crawler = crawler.WebCrawler()

        self.book_id = book_id
        self.base_chapter_url, self.volumes = self.get_book_chapters()
        self.volume_num = len(self.volumes)
        self.picture_urls = self.get_picture_urls()
        self.basic_info = self.get_basic_book_info()

    def get_picture_urls(self):
        """
        分别获取每一卷的图片链接后缀, 返回一个字典
        "第一卷":"125425.htm"
        """

        images = {}
        for volume, chapters in self.volumes.items():
            for chapter in chapters:
                if chapter['name'] == '插图':
                    images[volume] = chapter['link']

        return images

    def get_chapter_image_urls(self, volume_name=None):
        """
        获取指定卷的图片链接，返回一个列表，每个元素是一个图片链接
        https://pic.777743.xyz/3/3057/125425/165682.jpg
        """
        if not volume_name:
            return None

        for volume, chapters in self.volumes.items():
            if volume == volume_name:
                url = f'{self.base_chapter_url}{self.picture_urls[volume]}'
                soup = self.my_crawler.fetch(url).find_all('img')
                return [img['src'] for img in soup if 'src' in img.attrs]

    def get_basic_book_info(self):
        """获取轻小说文库的基本信息"""
        url = f'https://www.wenku8.net/book/{self.book_id}.htm'
        soup = self.my_crawler.fetch(url)
        content = soup.find('div', id='content')

        title = content.find('table').find('b').text

        # 提取基本信息
        book_info = content.find('table').find_all('tr')[2].find_all('td')

        # 文库分类
        category = book_info[0].text.split('：')[1]
        # 作者
        author = book_info[1].text.split('：')[1]
        # 连载状态
        status = book_info[2].text.split('：')[1]
        # 更新时间
        if len(book_info) > 3:
            update_time = book_info[3].text.split('：')[1]
        else:
            update_time = None
        # 全文长度
        if len(book_info) > 4:
            length = book_info[4].text.split('：')[1]
        else:
            length = None

        # 最近章节
        try:
            content = content.find('div').find_all('table')[2]
            latest_chapter = content.find('a').get_text(strip=True)
        except Exception as e:
            latest_chapter = None

        # 简介
        description = content.find_all('span')[-1].get_text()

        # 加载封面
        img_tags = soup.find_all('img')
        img_urls = [img['src'] for img in img_tags if 'src' in img.attrs]
        cover = img_urls[1] if len(img_urls) > 1 else None

        return {
            '标题': title,
            '作者': author,
            '出版社': category,
            '最新章节': latest_chapter,
            '连载状态': status,
            '更新时间': update_time,
            '全文长度': length,
            '简介': description,
            'cover': cover,
        }

    def get_book_chapters(self):
        """
        获取小说的章节信息
        :return: 返回一个元组，第一个元素是章节的URL，第二个元素是章节信息
        """
        chapter_url = f'https://www.wenku8.net'
        """获取章节信息的URL"""
        soup = self.my_crawler.fetch(f'https://www.wenku8.net/book/{self.book_id}.htm')
        content = soup.find('div', id='content').find('div').find_all('a')
        for a in content:
            if a.text == '小说目录':
                chapter_url = f"{chapter_url}{a['href']}"

        if not chapter_url:
            raise Exception("Failed to find chapter list URL.")

        """ 爬取章节信息 """
        soup = self.my_crawler.fetch(chapter_url).find('table', class_='css').find_all('tr')
        content = soup

        # 按卷分组
        volumes = {}
        current_volume = None

        for row in content:
            # 查找卷信息
            volume_tag = row.find('td', class_='vcss')
            if volume_tag:
                current_volume = volume_tag.get_text().strip()  # 获取卷名
                volumes[current_volume] = []

            # 查找章节链接和章节名
            link_tags = row.find_all('a', href=True)
            if link_tags and current_volume:
                for tag in link_tags:
                    chapter_name = tag.get_text().strip()  # 获取章节名
                    chapter_link = tag['href']  # 获取章节链接
                    volumes[current_volume].append({'name': chapter_name, 'link': chapter_link})

        base_chapter_url = chapter_url.replace('index.htm', '')

        return base_chapter_url, volumes

    def get_cover_content(self):
        """
        获取封面的二进制内容
        :return: 封面的二进制内容
        """
        return self.my_crawler.fetch(self.basic_info['cover'], False)

    def get_formatted_title(self, type):
        """
        获取用户自定义格式的标题
        :param type: 标题格式，FULL为完整标题，OUT保留括号外的部分，IN保留括号内的部分
        :return: 格式化后的标题
        """
        title = self.basic_info['标题']
        if type == 'FULL':
            return title
        else:
            match = re.match(r"^(.*?)\((.*?)\)$", title)
            if match:
                if type == 'OUT':
                    return match.group(1)
                elif type == 'IN':
                    return match.group(2)

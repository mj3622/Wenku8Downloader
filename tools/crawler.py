import http.cookies
import time

import requests
from bs4 import BeautifulSoup

from . import config_manager


def __encode_key__(key):
    """
    将关键字编码为URL参数
    :param key: 搜索关键字
    :return: 编码后的字符串
    """
    # 将关键字转换为进行搜索的格式
    encoded_bytes = key.encode('gbk')
    return ''.join([f'%{byte:02x}' for byte in encoded_bytes])


class WebCrawler:
    def __init__(self, cookie=None):
        self.config = config_manager.ConfigManager()
        # 初始化cookies，默认为空，用户可以在创建对象时传入cookie
        self.cookies = cookie or {
            'PHPSESSID': self.config.get('cookie', 'PHPSESSID'),
            'jieqiUserInfo': self.config.get('cookie', 'jieqiUserInfo'),
            'jieqiVisitInfo': self.config.get('cookie', 'jieqiVisitInfo'),
        }

    def fetch(self, url, parse=True):
        """
        获取指定URL的内容，自带cookie
        :param url: 请求的URL
        :param parse: 是否解析HTML，默认为True
        :return: 如果parse为False，返回原始二进制内容，否则返回BeautifulSoup对象
        """
        response = requests.get(url, headers={
            'Cookie': '; '.join([f'{key}={value}' for key, value in self.cookies.items()]),
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        })

        if response.status_code != 200:
            raise Exception(f"Failed to fetch {url}, status code: {response.status_code}")

        # 检测编码并解码内容
        content = response.content

        if not parse:
            return content

        # 使用BeautifulSoup解析HTML并返回
        soup = BeautifulSoup(content, 'html.parser')
        return soup

    def get_cookie(self):
        """
        根据配置文件中的用户名和密码获取新的cookies
        :return:
        """
        login_url = 'https://www.wenku8.net/login.php?do=submit&jumpurl=http%3A%2F%2Fwww.wenku8.net%2Findex.php'
        data = {
            'username': self.config.get('login', 'username'),
            'password': self.config.get('login', 'password'),
            'usecookie': '315360000',
            'action': 'login',
            'submit': ' %26%23160%3B%B5%C7%26%23160%3B%26%23160%3B%C2%BC%26%23160%3B',
        }

        response = requests.post(login_url, data=data, headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
            'Referer': 'https://www.wenku8.net/login.php',
        })

        # 从返回的响应头中解析 cookies
        cookie_header = response.headers.get('set-cookie', '')
        cookie_jar = http.cookies.SimpleCookie(cookie_header)
        new_cookies = {key: morsel.value for key, morsel in cookie_jar.items()}

        # 更新cookies
        if new_cookies:
            self.cookies.update(new_cookies)
            # 更新配置文件
            self.config.set('cookie', 'PHPSESSID', new_cookies['PHPSESSID'])
            self.config.set('cookie', 'jieqiUserInfo', new_cookies['jieqiUserInfo'])
            self.config.set('cookie', 'jieqiVisitInfo', new_cookies['jieqiVisitInfo'])
            print("Cookies updated.")

    def get_image_content(self, url):
        """
        下载图片并返回原始二进制内容
        :param url: 图片的URL
        :return: 图片的二进制内容
        """
        headers = {
            'Referer': 'https://www.wenku8.net/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
        }

        try:
            response = requests.get(url, headers=headers)
        except Exception as e:
            print(f"Failed to download {url}: {e}")
            # 重试
            while True:
                try:
                    response = requests.get(url, headers=headers)
                    break
                except Exception as e:
                    print(f"Failed to download {url}: {e}")
                    time.sleep(1)

        if response.status_code == 200:
            return response.content
        else:
            print(f"Failed to download {url}: {response.status_code}")
            return None

    def search(self, keyword, type):
        """
        搜索小说
        :param keyword: 搜索关键字
        :param type: 搜索类型，articlename为按书名搜索，author为按作者搜索
        :return: 一个列表，包含搜索结果 {'title': '书名', 'cover': '封面url', 'id': '书籍ID'}
        """
        url = f"https://www.wenku8.net/modules/article/search.php?searchtype={type}&searchkey={__encode_key__(keyword)}"

        content = self.fetch(url)

        if content.find('title').text.find('搜索结果 - 轻小说文库') != -1:
            content = content.find('div', id='content').find('table').find('tr').find('td').find_all('a')
            res = []
            for a in content:
                if a.find('img'):
                    res.append({'title': a['title'], 'cover': a.img['src'], 'id': a['href'].split('/')[-1].split('.')[0]})

            return res
        else:
            title = content.find('title').text.split('-')[0].strip()
            cover = content.find('div', id='content').find('img')['src']
            book_id = cover.split('/')[-2]
            return [{'title': title, 'cover': cover, 'id': book_id}]

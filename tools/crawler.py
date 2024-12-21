import requests
from bs4 import BeautifulSoup
import http.cookies
from . import config_manager
from PIL import Image
from io import BytesIO


class WebCrawler:
    def __init__(self, cookie=None):
        self.config = config_manager.ConfigManager()
        # 初始化cookies，默认为空，用户可以在创建对象时传入cookie
        self.cookies = cookie or {
            'PHPSESSID': self.config.get('cookie', 'PHPSESSID'),
            'jieqiUserInfo': self.config.get('cookie', 'jieqiUserInfo'),
            'jieqiVisitInfo': self.config.get('cookie', 'jieqiVisitInfo'),
        }

    def fetch(self, url):
        """通过给定URL抓取网页，并返回BeautifulSoup解析后的对象"""
        response = requests.get(url, headers={
            'Cookie': '; '.join([f'{key}={value}' for key, value in self.cookies.items()]),
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
        })

        if response.status_code != 200:
            raise Exception(f"Failed to fetch {url}, status code: {response.status_code}")

        # 检测编码并解码内容
        content = response.content

        # 使用BeautifulSoup解析HTML并返回
        soup = BeautifulSoup(content, 'html.parser')
        return soup

    def get_cookie(self):
        """通过登录请求获取新cookie"""
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

    def parse_chapter(self, url):
        """解析图片链接为streamlit可用格式"""
        headers = {
            'Referer': 'https://www.wenku8.net/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
        }
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            # 将图片数据读取为二进制
            return Image.open(BytesIO(response.content))
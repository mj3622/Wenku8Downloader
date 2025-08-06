import http.cookies
import time
import random
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import requests
from bs4 import BeautifulSoup
from fake_useragent import UserAgent
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
        # 初始化UserAgent生成器
        self.ua = UserAgent()
        # 初始化cookies，默认为空，用户可以在创建对象时传入cookie
        self.cookies = cookie or {
            'PHPSESSID': self.config.get('cookie', 'PHPSESSID'),
            'jieqiUserInfo': self.config.get('cookie', 'jieqiUserInfo'),
            'jieqiVisitInfo': self.config.get('cookie', 'jieqiVisitInfo'),
        }
        # 创建带有重试机制的会话
        self.session = self._create_session()
        # 随机请求间隔范围(秒)
        self.delay_range = (1, 3)
        # 最后一次请求时间
        self.last_request_time = 0

    def _create_session(self):
        """创建带有重试机制的会话"""
        session = requests.Session()

        # 设置重试策略
        retry_strategy = Retry(
            total=3,  # 总重试次数
            backoff_factor=1,  # 重试间隔时间因子
            status_forcelist=[429, 500, 502, 503, 504]  # 需要重试的状态码
        )

        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("https://", adapter)
        session.mount("http://", adapter)

        return session

    def _wait_for_rate_limit(self):
        """控制请求频率，确保不会过于频繁"""
        elapsed = time.time() - self.last_request_time
        if elapsed < self.delay_range[0]:
            # 计算需要等待的时间，加入随机因素
            wait_time = random.uniform(self.delay_range[0] - elapsed, self.delay_range[1] - elapsed)
            time.sleep(wait_time)
        self.last_request_time = time.time()

    def _get_headers(self, referer='https://www.wenku8.net/'):
        """生成随机请求头"""
        return {
            'Cookie': '; '.join([f'{key}={value}' for key, value in self.cookies.items()]),
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': self.ua.random,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Referer': referer
        }

    def fetch(self, url, parse=True, max_retries=3):
        """
        获取指定URL的内容，自带cookie和防429措施
        :param url: 请求的URL
        :param parse: 是否解析HTML，默认为True
        :param max_retries: 最大重试次数
        :return: 如果parse为False，返回原始二进制内容，否则返回BeautifulSoup对象
        """
        retries = 0
        while retries <= max_retries:
            try:
                # 控制请求频率
                self._wait_for_rate_limit()

                # 发送请求
                response = self.session.get(
                    url,
                    headers=self._get_headers(url),
                    timeout=10
                )

                # 检查状态码
                response.raise_for_status()

                # 处理429状态码（即使raise_for_status不会触发，这里额外处理）
                if response.status_code == 429:
                    retry_after = int(response.headers.get('Retry-After', 10))
                    print(f"请求过于频繁，将在{retry_after}秒后重试...")
                    time.sleep(retry_after)
                    retries += 1
                    continue

                content = response.content

                if not parse:
                    return content

                # 使用BeautifulSoup解析HTML并返回
                soup = BeautifulSoup(content, 'html.parser')
                return soup

            except requests.exceptions.HTTPError as e:
                if response.status_code == 429:
                    retry_after = int(response.headers.get('Retry-After', 10))
                    print(f"HTTP错误 {response.status_code}: {e}, 将在{retry_after}秒后重试...")
                    time.sleep(retry_after)
                else:
                    print(f"HTTP错误 {response.status_code}: {e}")
                    if retries >= max_retries:
                        raise Exception(f"Failed to fetch {url}, status code: {response.status_code}")
            except Exception as e:
                print(f"请求错误: {e}")
                if retries >= max_retries:
                    raise Exception(f"Failed to fetch {url} after {max_retries} retries: {str(e)}")

            retries += 1
            # 指数退避重试
            if retries <= max_retries:
                sleep_time = 2 ** retries + random.random()
                print(f"将在{sleep_time:.2f}秒后重试...")
                time.sleep(sleep_time)

        return None

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

        # 控制请求频率
        self._wait_for_rate_limit()

        response = self.session.post(
            login_url,
            data=data,
            headers=self._get_headers('https://www.wenku8.net/login.php')
        )

        # 从返回的响应头中解析 cookies
        cookie_header = response.headers.get('set-cookie', '')
        cookie_jar = http.cookies.SimpleCookie(cookie_header)
        new_cookies = {key: morsel.value for key, morsel in cookie_jar.items()}

        # 更新cookies
        if new_cookies:
            self.cookies.update(new_cookies)
            # 更新配置文件
            if 'PHPSESSID' in new_cookies:
                self.config.set('cookie', 'PHPSESSID', new_cookies['PHPSESSID'])
            if 'jieqiUserInfo' in new_cookies:
                self.config.set('cookie', 'jieqiUserInfo', new_cookies['jieqiUserInfo'])
            if 'jieqiVisitInfo' in new_cookies:
                self.config.set('cookie', 'jieqiVisitInfo', new_cookies['jieqiVisitInfo'])
            print("Cookies updated.")

    def get_image_content(self, url, max_retries=3):
        """
        下载图片并返回原始二进制内容
        :param url: 图片的URL
        :param max_retries: 最大重试次数
        :return: 图片的二进制内容
        """
        retries = 0
        while retries <= max_retries:
            try:
                # 控制请求频率
                self._wait_for_rate_limit()

                response = self.session.get(
                    url,
                    headers=self._get_headers(),
                    timeout=10
                )

                response.raise_for_status()

                # 处理429状态码
                if response.status_code == 429:
                    retry_after = int(response.headers.get('Retry-After', 10))
                    print(f"图片请求过于频繁，将在{retry_after}秒后重试...")
                    time.sleep(retry_after)
                    retries += 1
                    continue

                return response.content

            except Exception as e:
                print(f"下载图片失败 {url}: {e}")
                if retries >= max_retries:
                    return None

            retries += 1
            sleep_time = 2 ** retries + random.random()
            print(f"将在{sleep_time:.2f}秒后重试下载图片...")
            time.sleep(sleep_time)

        return None

    def search(self, keyword, type):
        """
        搜索小说
        :param keyword: 搜索关键字
        :param type: 搜索类型，articlename为按书名搜索，author为按作者搜索
        :return: 一个列表，包含搜索结果 {'title': '书名', 'cover': '封面url', 'id': '书籍ID'}
        """
        encoded_keyword = __encode_key__(keyword)
        url = f"https://www.wenku8.net/modules/article/search.php?searchtype={type}&searchkey={encoded_keyword}"

        content = self.fetch(url)
        if not content:
            return []

        try:
            if content.find('title').text.find('搜索结果 - 轻小说文库') != -1:
                content = content.find('div', id='content').find('table').find('tr').find('td').find_all('a')
                res = []
                for a in content:
                    if a.find('img'):
                        res.append({
                            'title': a['title'],
                            'cover': a.img['src'],
                            'id': a['href'].split('/')[-1].split('.')[0]
                        })
                return res
            else:
                title = content.find('title').text.split('-')[0].strip()
                cover = content.find('div', id='content').find('img')['src']
                book_id = cover.split('/')[-2]
                return [{'title': title, 'cover': cover, 'id': book_id}]
        except Exception as e:
            print(f"解析搜索结果失败: {e}")
            return []

"""
crawler.py - 网络请求与内容抓取模块

封装对轻小说文库（wenku8.net）的 HTTP 请求，包括：
  - 带 Cookie 的页面抓取
  - 账号登录 / Cookie 刷新
  - 图片二进制内容下载（含限次重试）
  - 关键字搜索
"""

from typing import Optional
import time

from curl_cffi import requests
from bs4 import BeautifulSoup
from fake_useragent import UserAgent
from . import config_manager

# 最大图片下载重试次数
_MAX_IMAGE_RETRIES = 3

# 公共请求头（典型的 Chrome 特征）
_COMMON_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}

# Cloudflare 要求的 Client Hints（critical-ch）
_CLIENT_HINTS = {
    "Sec-CH-UA": '"Not(A:Brand";v="8", "Chromium";v="144", "Microsoft Edge";v="144"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"macOS"',
    "Sec-CH-UA-Platform-Version": '"15.0.0"',
    "Sec-CH-UA-Arch": '"arm"',
    "Sec-CH-UA-Bitness": '"64"',
    "Sec-CH-UA-Full-Version-List": '"Not(A:Brand";v="8.0.0.0", "Chromium";v="144.0.0.0", "Microsoft Edge";v="144.0.0.0"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}


def _encode_key(key: str) -> str:
    """
    将搜索关键字编码为 GBK 百分号格式，以适配文库的搜索接口。

    :param key: 原始搜索关键字（Unicode 字符串）
    :return: 编码后的 URL 参数字符串，如 "%c4%cf%......"
    """
    encoded_bytes = key.encode("gbk")
    return "".join([f"%{byte:02x}" for byte in encoded_bytes])


class WebCrawler:
    """
    轻小说文库爬虫，封装所有与网站交互的 HTTP 请求。

    会话 Cookie 从配置文件中读取，也可在实例化时手动传入。
    """

    def __init__(self, cookie: dict = None):
        """
        初始化爬虫，加载配置并准备 Cookie。

        :param cookie: 可选，手动传入的 Cookie 字典；
                       若为 None，则从配置文件中读取
        """
        self.config = config_manager.ConfigManager()
        self.cookies = cookie or {
            "PHPSESSID": self.config.get("cookie", "PHPSESSID"),
            "jieqiUserInfo": self.config.get("cookie", "jieqiUserInfo"),
            "jieqiVisitInfo": self.config.get("cookie", "jieqiVisitInfo"),
            "cf_clearance": self.config.get("cookie", "cf_clearance") or "",
        }

        # 读取代理配置（留空则不使用代理）
        proxy_http = self.config.get("proxy", "http") or ""
        proxy_https = self.config.get("proxy", "https") or ""
        self.proxies = {
            "http": proxy_http if proxy_http else None,
            "https": proxy_https if proxy_https else None,
        } if (proxy_http or proxy_https) else None

        # 初始化持久型 Session 模拟浏览器，以复用 TLS 连接特征，防止被频控拉黑
        self.session = requests.Session(impersonate="chrome120", proxies=self.proxies)
        # 将现有的 cookies 注入到 session 里
        for k, v in self.cookies.items():
            if v:
                self.session.cookies.set(k, v)

    # ------------------------------------------------------------------
    # 公开方法
    # ------------------------------------------------------------------

    def fetch(self, url: str, parse: bool = True):
        """
        发起 GET 请求并返回页面内容。

        :param url: 目标 URL
        :param parse: 为 True 时返回 BeautifulSoup 对象；
                      为 False 时返回原始二进制内容
        :return: BeautifulSoup 对象或 bytes
        :raises Exception: 当 HTTP 状态码非 200 时抛出
        """
        req_headers = _COMMON_HEADERS.copy()
        req_headers["Referer"] = "https://www.wenku8.net/"

        max_retries = 3
        for attempt in range(max_retries):
            # 注意这里不再单独传 cookies，因为 self.session 已经包含 CookieJar
            try:
                response = self.session.get(
                    url,
                    headers=req_headers,
                    allow_redirects=True,
                )
            except Exception as e:
                response = None
                print(f"[fetch] 请求出错：{e}")

            if response is not None and response.status_code == 200:
                if not parse:
                    return response.content
                # 使用 html.parser 解析响应内容
                soup = BeautifulSoup(response.content, "html.parser")
                # 把最终 URL 挂载到 soup 对象上，方便外部提取（如防重定向重写）
                soup.my_url = response.url
                return soup

            # 处理 403 或其他状态码（可能被 Cloudflare 拦截）
            status = response.status_code if response is not None else "ERROR"
            print(f"[fetch] 尝试 {attempt + 1}/{max_retries} 返回 {status}（可能遭遇 Cloudflare 拦截/网络波动）。")
            if attempt < max_retries - 1:
                print("[fetch] 正在重置会话并等待 8 秒后重试...")
                time.sleep(8)
                # 重新初始化 Session 以刷新 TLS 握手状态
                self.session = requests.Session(impersonate="chrome120", proxies=self.proxies)
                for k, v in self.cookies.items():
                    if v:
                        self.session.cookies.set(k, v)
        status_code = response.status_code if response is not None else "Unknown"
        raise Exception(f"请求失败：{url}，已达到最大重试次数（最后状态码：{status_code}）")

    def get_cookie(self) -> None:
        """
        使用配置文件中的账号密码登录，并将新的 Cookie 写回配置文件。

        登录成功后自动更新内存中的 Cookie 以及 config/secrets.toml。
        """
        login_url = (
            "https://www.wenku8.net/login.php"
            "?do=submit&jumpurl=http%3A%2F%2Fwww.wenku8.net%2Findex.php"
        )
        post_data = {
            "username": self.config.get("login", "username"),
            "password": self.config.get("login", "password"),
            "usecookie": "315360000",
            "action": "login",
            "submit": " %26%23160%3B%B5%C7%26%23160%3B%26%23160%3B%C2%BC%26%23160%3B",
        }

        req_headers = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://www.wenku8.net",
            "Referer": "https://www.wenku8.net/login.php",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }

        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = self.session.post(
                    login_url,
                    data=post_data,
                    headers=req_headers,
                    allow_redirects=True,
                )
            except Exception as e:
                response = None
                print(f"[login] 请求出错：{e}")

            if response is not None and response.status_code == 200:
                break  # 成功，跳出重试
            
            status = response.status_code if response is not None else "ERROR"
            print(f"[login] 尝试 {attempt + 1}/{max_retries} 返回 {status}（可能遭遇 Cloudflare 拦截/网络波动）。")
            if attempt < max_retries - 1:
                print("[login] 正在重置会话并等待 5 秒后重试...")
                time.sleep(5)
                # 重新初始化 Session 以刷新 TLS 握手状态
                self.session = requests.Session(impersonate="chrome120", proxies=self.proxies)
                for k, v in self.cookies.items():
                    if v:
                        self.session.cookies.set(k, v)

        if response is None:
            raise Exception("登录失败：达到最大重试次数且无响应。")

        print(f"[login] 状态码: {response.status_code}")
        print(f"[login] 最终 URL: {response.url}")
        print(f"[login] 响应头 Set-Cookie: {response.headers.get('set-cookie', '（无）')}")
        print(f"[login] response.cookies: {dict(response.cookies)}")
        print(f"[login] 所有响应头: { dict(response.headers) }")

        # 从自动合并的 CookieJar 中读取新 Cookie
        new_cookies = dict(self.session.cookies)

        if new_cookies:
            # 更新内存中的 Cookie
            self.cookies.update(new_cookies)
            # 持久化到配置文件
            self.config.set("cookie", "PHPSESSID", new_cookies.get("PHPSESSID", ""))
            self.config.set("cookie", "jieqiUserInfo", new_cookies.get("jieqiUserInfo", ""))
            self.config.set("cookie", "jieqiVisitInfo", new_cookies.get("jieqiVisitInfo", ""))
            if new_cookies.get("cf_clearance"):
                self.config.set("cookie", "cf_clearance", new_cookies.get("cf_clearance", ""))
            print("[login] ✅ Cookie 已更新并写入配置文件。")
            print(f"[login] 新 Cookie keys: {list(new_cookies.keys())}")
        else:
            print("[login] ❌ 未能从响应中解析到新 Cookie。")
            if response.status_code == 403:
                raise Exception(
                    "登录端点返回 403（被 Cloudflare 或 IP 封锁）。\n"
                    "请通过「🍪 Cookie」标签手动粘贴浏览器 Cookie。"
                )
            else:
                raise Exception(
                    f"登录失败（HTTP {response.status_code}），请检查账号密码或网络。"
                )

    def get_cookie_via_browser(self) -> None:
        """
        使用 DrissionPage 控制真实 Chromium 浏览器完成登录，
        可靠获取包括 cf_clearance 在内的全部 Cookie，并写入配置文件。

        相比纯 HTTP 方式，浏览器能真正通过 Cloudflare JS 挑战，
        因此可以稳定获得 cf_clearance。
        """
        from DrissionPage import ChromiumPage, ChromiumOptions

        username = self.config.get("login", "username")
        password = self.config.get("login", "password")

        if not username or not password:
            error_msg = "账号或密码未配置，请先在「👤 账号」标签填写。"
            print(f"[browser-login] ❌ {error_msg}")
            raise Exception(error_msg)

        print("[browser-login] 正在启动浏览器...")
        opts = ChromiumOptions()
        # 不使用无头模式，避免被 Cloudflare 识别为自动化工具
        opts.set_argument("--disable-blink-features=AutomationControlled")

        try:
            page = ChromiumPage(addr_or_opts=opts)
        except Exception as e:
            if "not found" in str(e).lower() or "browser" in str(e).lower():
                error_msg = (
                    "启动浏览器失败：未能在系统中找到 Chrome/Edge 浏览器。\n"
                    "请确保已安装 Google Chrome 或 Microsoft Edge 浏览器。\n"
                    "如果你已安装但依然报错，请在 DrissionPage 全局配置中指定浏览器路径。"
                )
                print(f"[browser-login] ❌ {error_msg}")
                raise Exception(error_msg)
            else:
                raise

        try:
            login_url = (
                "https://www.wenku8.net/login.php"
                "?do=submit&jumpurl=http%3A%2F%2Fwww.wenku8.net%2Findex.php"
            )
            print(f"[browser-login] 正在导航到登录页...")
            page.get("https://www.wenku8.net/login.php")

            # 等待 Cloudflare 挑战通过（最多 15 秒），标志是登录表单出现
            print("[browser-login] 等待 Cloudflare 验证通过...")
            page.wait.ele_displayed("css:[name=username]", timeout=20)

            # 填写表单
            print("[browser-login] 正在填写账号密码并设定较长有效时间...")
            page.ele("css:[name=username]").clear().input(username)
            page.ele("css:[name=password]").clear().input(password)
            
            # 选择“有效时间”下拉框中的“保存一年”选项
            usecookie_ele = page.ele("css:select[name=usecookie]")
            if usecookie_ele:
                usecookie_ele.select("保存一年")

            # 点击登录按钮
            page.ele("css:[name=submit]", timeout=10).click()

            # 等待跳转离开登录页（最多 20 秒）
            print("[browser-login] 等待登录跳转...")
            # wait.url_change(text) 要求当前 URL 必须变化且包含或不包含 text
            page.wait.url_change("login.php", exclude=True, timeout=20)

            # 检查是否跳转出了登录页（跳转失败则仍在 login.php）
            if "login.php" in page.url:
                error_msg = "账号密码错误或登录被拒绝，请检查账号配置。"
                print(f"[browser-login] ❌ {error_msg}")
                raise Exception(error_msg)

            # 提取所有 Cookie（DrissionPage 4.x page.cookies() 返回 CookiesList，需手动转字典）
            cookies_list = page.cookies()
            raw_cookies = {cookie["name"]: cookie["value"] for cookie in cookies_list}
            print(f"[browser-login] 获取到 Cookie keys: {list(raw_cookies.keys())}")

            # 写入配置
            self.config.set("cookie", "PHPSESSID", raw_cookies.get("PHPSESSID", ""))
            self.config.set("cookie", "jieqiUserInfo", raw_cookies.get("jieqiUserInfo", ""))
            self.config.set("cookie", "jieqiVisitInfo", raw_cookies.get("jieqiVisitInfo", ""))
            if raw_cookies.get("cf_clearance"):
                self.config.set("cookie", "cf_clearance", raw_cookies.get("cf_clearance", ""))
                print("[browser-login] ✅ cf_clearance 已获取并写入。")
            else:
                print("[browser-login] ⚠️ 未获取到 cf_clearance（可能本次请求未触发 Cloudflare 挑战，通常不影响使用）。")

            # 同步更新内存中的 cookies 与 session
            self.cookies.update({
                "PHPSESSID": raw_cookies.get("PHPSESSID", ""),
                "jieqiUserInfo": raw_cookies.get("jieqiUserInfo", ""),
                "jieqiVisitInfo": raw_cookies.get("jieqiVisitInfo", ""),
                "cf_clearance": raw_cookies.get("cf_clearance", ""),
            })
            from curl_cffi import requests as cffi_requests
            self.session = cffi_requests.Session(
                impersonate="chrome120", proxies=self.proxies
            )
            for k, v in self.cookies.items():
                if v:
                    self.session.cookies.set(k, v)

            print("[browser-login] ✅ 所有 Cookie 已更新并写入配置文件。")

        except Exception as e:
            print(f"[browser-login] ❌ 发生异常: {e}")
            raise
        finally:
            page.quit()
            print("[browser-login] 浏览器已关闭。")


    def get_image_content(self, url: str) -> Optional[bytes]:
        """
        下载图片并返回原始二进制内容，失败时最多重试 _MAX_IMAGE_RETRIES 次。

        :param url: 图片的完整 URL
        :return: 图片的 bytes 内容；全部重试失败后返回 None
        """
        headers = _COMMON_HEADERS.copy()
        headers["Referer"] = "https://www.wenku8.net/"

        response = None
        try:
            response = self.session.get(
                url, headers=headers, allow_redirects=True
            )
        except Exception as e:
            print(f"图片下载失败，开始重试：{url}（{e}）")
            # 有限次数重试
            for attempt in range(_MAX_IMAGE_RETRIES):
                try:
                    response = self.session.get(url, headers=headers)
                    break   # 请求成功，跳出重试循环
                except Exception as retry_e:
                    print(
                        f"第 {attempt + 1}/{_MAX_IMAGE_RETRIES} 次重试失败："
                        f"{url}（{retry_e}）"
                    )
                    time.sleep(1)
            else:
                # for-else：循环正常结束（未 break），说明全部重试均失败
                print(f"已达最大重试次数，放弃下载：{url}")
                return None

        if response is not None and response.status_code == 200:
            return response.content

        status = response.status_code if response is not None else "N/A"
        print(f"图片下载失败：{url}，状态码：{status}")
        return None

    def search(self, keyword: str, search_type: str) -> list[dict]:
        """
        按关键字搜索小说。

        :param keyword: 搜索关键字
        :param search_type: 搜索类型，"articlename" 按书名，"author" 按作者
        :return: 搜索结果列表，每项格式为
                 {"title": str, "cover": str, "id": str}
        """
        url = (
            "https://www.wenku8.net/modules/article/search.php"
            f"?searchtype={search_type}&searchkey={_encode_key(keyword)}"
        )
        page = self.fetch(url)
        
        title_tag = page.find("title")
        if not title_tag:
            raise Exception("无法解析返回页面，可能已被 Cloudflare 等机制拦截")
        title_text = title_tag.text

        # 检查是否命中包含 .blockcontent 的系统提示页（如搜索间隔 < 5s 或需重新登录）
        err_block = page.find("div", class_="blockcontent")
        if err_block and "两次搜索的间隔时间" in err_block.text:
            raise Exception("文库限制：两次搜索的间隔时间不得少于 5 秒，请稍后再试。")

        # 判断是搜索结果列表页，还是直接跳转到书籍详情页
        if "搜索结果 - 轻小说文库" in title_text:
            # 多结果页：提取所有带封面图的 <a> 标签
            anchor_tags = (
                page.find("div", id="content")
                .find("table")
                .find("tr")
                .find("td")
                .find_all("a")
            )
            results = []
            container_td = page.find("div", id="content").find("table").find("tr").find("td")
            if container_td:
                for item_div in container_td.find_all("div", recursive=False):
                    a_tag = item_div.find("a")
                    if not a_tag or not a_tag.find("img"):
                        continue
                        
                    title = a_tag.get("title", "")
                    cover = a_tag.img.get("src", "")
                    
                    href = a_tag.get("href", "")
                    book_id = href.split("/")[-1].split(".")[0] if href else ""
                    
                    author = ""
                    status = ""
                    tags = ""
                    desc = ""
                    
                    divs = item_div.find_all("div", recursive=False)
                    if len(divs) > 1:
                        info_div = divs[1]
                        ps = info_div.find_all("p")
                        
                        if len(ps) > 0:
                            author_cat = ps[0].get_text()
                            if "作者:" in author_cat:
                                author = author_cat.split("/")[0].replace("作者:", "").strip()
                        
                        if len(ps) > 1:
                            update_status = ps[1].get_text()
                            if "连载中" in update_status:
                                status = "连载中"
                            elif "已完结" in update_status:
                                status = "已完结"
                            else:
                                status = "未知"
                                
                        if len(ps) > 2:
                            tags = ps[2].get_text().replace("Tags:", "").strip()
                            
                        if len(ps) > 3:
                            desc = ps[3].get_text().replace("简介:", "").strip()
                            
                    results.append({
                        "title": title,
                        "cover": cover,
                        "id": book_id,
                        "author": author,
                        "status": status,
                        "tags": tags,
                        "desc": desc,
                    })
            return results
        
        # 尝试作为单结果页（直接跳转到书籍详情）提取
        content_div = page.find("div", id="content")
        if content_div and content_div.find("img"):
            title = title_text.split("-")[0].strip()
            
            # 由于可能发生了重定向（例如搜索直接跳到书页），应当从最终 URL 中提取数字 ID
            # 格式：https://www.wenku8.net/book/1234.htm
            final_url = getattr(page, "my_url", "")
            if "/book/" in final_url:
                book_id = final_url.split("/")[-1].split(".")[0]
            else:
                # 后备方案：从图片尝试，但非常不可靠
                book_id = content_div.find("img")["src"].split("/")[-2]
                
            cover = content_div.find("img")["src"]
            
            author = ""
            status = ""
            desc = ""
            try:
                info_table = content_div.find("table")
                if info_table:
                    info_cells = info_table.find_all("tr")[2].find_all("td")
                    if len(info_cells) > 1:
                        author = info_cells[1].text.split("：")[-1].strip()
                    if len(info_cells) > 2:
                        status = info_cells[2].text.split("：")[-1].strip()
                spans = content_div.find_all("span")
                for i, span in enumerate(spans):
                    if "内容简介：" in span.get_text():
                        if len(span.get_text().strip()) > 5:
                            desc = span.get_text().replace("内容简介：", "").strip()
                        elif i + 1 < len(spans):
                            desc = spans[i + 1].get_text().strip()
                        break
            except Exception:
                pass
                
            return [{
                "title": title, 
                "cover": cover, 
                "id": book_id,
                "author": author,
                "status": status,
                "tags": "",
                "desc": desc
            }]

        # 既不是搜索结果列表，也不是书籍详情（例如：搜索无结果、触发了其他未写明的防刷/重定向返回用户中心等）
        return []

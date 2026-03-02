"""
app.py - Wenku8Downloader 主入口

基于 Streamlit 构建的多页面 Web 应用，提供以下功能页面：
  - 主页：功能介绍与快捷入口
  - 配置：账号、Cookie 及下载选项设置
  - 编号检索：按书籍编号查询书籍详情
  - 作者检索：按作者名搜索并跳转到详情
  - 书名检索：按书名搜索并跳转到详情
  - 整本下载：将整本小说下载为 EPUB
  - 分卷下载：按选定卷下载为 EPUB
  - 图片下载：按卷或全书下载插图

运行方式：
    streamlit run app.py
"""

import os
import time
from typing import List

import streamlit as st

from tools.book import Book
from tools.config_manager import ConfigManager
from tools.crawler import WebCrawler
from tools.downloader import Downloader

# ------------------------------------------------------------------
# 应用级单例（模块加载时创建一次，所有页面共享）
# ------------------------------------------------------------------
config = ConfigManager()
crawler = WebCrawler()
downloader = Downloader()


# ==================================================================
# 页面函数
# ==================================================================

def home_page() -> None:
    """主页：展示工具简介、功能列表和注意事项。"""
    st.title("🎉 Welcome!")

    st.subheader("简介")
    st.write(
        "欢迎使用轻小说文库 EPUB 下载器，本工具基于 "
        "[轻小说文库](https://www.wenku8.net/) 和 "
        "[Streamlit](https://streamlit.io/) 构建，"
        "可用于下载轻小说文库的小说并保存为 EPUB 格式。"
    )
    st.image(os.path.join(os.getcwd(), "docs", "pics", "search_page.png"))
    st.page_link(
        st.Page(search_by_id_page),
        label="开始使用",
        icon=":material/arrow_forward:",
        use_container_width=True,
    )

    st.write("**功能列表**")
    st.write("- ✅ 查询文库中的小说信息（支持按编号、书名、作者查询）")
    st.write("- ✅ 下载整本小说或分卷下载")
    st.write("- ✅ 单独下载小说插图")
    st.write("- ✅ 支持个性化下载配置")
    st.write("- ✅ **自动突破 Cloudflare 盾与 403 拦截（内置 TLS 指纹伪造）**")
    st.write("- ✅ **自带连接失败与被网站限流时的自动挂起自愈重试机制**")

    st.write("")
    st.write("**注意事项**")
    st.write("- ❗ 本工具仅用于学习交流，请勿滥用，遵守相关法律法规")
    st.write("- ⚠️ 暂不支持下载已下架小说")

    st.write("")
    st.write("**关于**")
    st.write("如果有任何问题或建议，欢迎在 GitHub 上提出。如果觉得好用，欢迎给个 Star ⭐。")
    st.page_link(
        "https://github.com/mj3622/Wenku8Downloader",
        label="GitHub 项目地址",
        icon=":material/link:",
        use_container_width=True,
    )


def config_page() -> None:
    """配置页面：账号、Cookie 和下载选项设置。"""
    st.title("⚙️ 配置")

    tab_account, tab_cookie, tab_download = st.tabs(["👤 账号", "🍪 Cookie", "📥 下载设置"])

    # ══════════════════ Tab 1：账号 ══════════════════
    with tab_account:
        st.subheader("账号信息")
        st.caption("填写账号后点击保存，将自动尝试刷新 Cookie。")

        username = st.text_input(
            "用户名",
            value=config.get("login", "username"),
            placeholder="请输入轻小说文库用户名",
        )
        password = st.text_input(
            "密码",
            value=config.get("login", "password"),
            type="password",
            placeholder="请输入密码",
        )

        st.divider()
        st.subheader("代理设置（可选）")
        st.caption("项目已内置智能 TLS 伪装。仅当你所在网络被网站完全拉黑封禁导致连接报错时才需填写代理。留空系统将自动直连。")
        col_ph, col_ps = st.columns(2)
        with col_ph:
            proxy_http = st.text_input(
                "HTTP 代理",
                value=config.get("proxy", "http") or "",
                placeholder="例如：http://127.0.0.1:7897",
            )
        with col_ps:
            proxy_https = st.text_input(
                "HTTPS 代理",
                value=config.get("proxy", "https") or "",
                placeholder="例如：http://127.0.0.1:7897",
            )

        feedback_account = st.empty()
        if st.button("💾 保存账号与代理", use_container_width=True, type="primary"):
            config.set("login", "username", username)
            config.set("login", "password", password)
            config.set("proxy", "http", proxy_http)
            config.set("proxy", "https", proxy_https)
            # 同步更新内存中的 crawler.proxies，立即生效
            new_proxies = {
                "http": proxy_http if proxy_http.strip() else None,
                "https": proxy_https if proxy_https.strip() else None,
            } if (proxy_http.strip() or proxy_https.strip()) else None
            crawler.proxies = new_proxies
            with feedback_account:
                st.success("✅ 账号与代理配置已保存并立即生效！")



    # ══════════════════ Tab 2：Cookie ══════════════════
    with tab_cookie:
        feedback_cookie = st.empty()

        st.write("### 🤖 自动获取 (推荐)")
        st.write("点击下方按钮将启动隐形浏览器自动完成登录（绕过 Cloudflare 防护）。")
        if st.button("🚀 一键获取 / 刷新 Cookie", use_container_width=True, type="primary"):
            with feedback_cookie:
                with st.spinner("正在启动无感浏览器环境获取 Cookie，请稍候..."):
                    try:
                        crawler.get_cookie()
                        st.success("🎉 Cookie 自动获取成功！已写入配置并立即生效。")
                        # 强制重新加载以更新下方输入框的显示
                        time.sleep(1)
                        st.rerun()
                    except Exception as e:
                        st.error(f"❌ 自动获取失败: {e}\n\n请检查网络、代理配置或「👤 账号」是否正确。也可以尝试下方的「手动配置」。")

        st.divider()

        st.write("### ✍️ 手动配置 (备用)")
        st.caption(
            "如果自动获取失败，请从浏览器手动复制 Cookie 粘贴到下方。\n\n"
            "**获取步骤**：浏览器登录 wenku8.net → F12 → Network → 任意请求 "
            "→ 请求头中找到 `Cookie` 字段，逐一复制对应值。"
        )

        phpsessid = st.text_input(
            "PHPSESSID",
            value=config.get("cookie", "PHPSESSID") or "",
            placeholder="例：8d65cffc80198434fcfb67ac43188bbd",
        )
        jieqi_user_info = st.text_area(
            "jieqiUserInfo",
            value=config.get("cookie", "jieqiUserInfo") or "",
            height=100,
            placeholder="例：jieqiUserId%3D...",
        )
        jieqi_visit_info = st.text_input(
            "jieqiVisitInfo",
            value=config.get("cookie", "jieqiVisitInfo") or "",
            placeholder="例：jieqiUserLogin%3D...",
        )
        cf_clearance = st.text_area(
            "cf_clearance（Cloudflare 验证 Cookie）",
            value=config.get("cookie", "cf_clearance") or "",
            height=80,
            placeholder="例：3zAI8DFl...",
            help="与你的代理出口 IP 绑定，失效后需重新从浏览器获取。",
        )

        if st.button("💾 保存手动填写的 Cookie", use_container_width=True):
            new_cookies = {
                "PHPSESSID": phpsessid.strip(),
                "jieqiUserInfo": jieqi_user_info.strip(),
                "jieqiVisitInfo": jieqi_visit_info.strip(),
                "cf_clearance": cf_clearance.strip(),
            }
            # 写入文件
            for key, val in new_cookies.items():
                config.set("cookie", key, val)
            # 同步更新内存中的 crawler，立即生效
            crawler.cookies.update(new_cookies)
            with feedback_cookie:
                st.success("✅ Cookie 已保存并立即生效！")


    # ══════════════════ Tab 3：下载设置 ══════════════════
    with tab_download:
        st.subheader("书名格式")
        download_choice = config.get("download", "full_title") or "FULL"
        index_map = {"FULL": 0, "IN": 1, "OUT": 2}
        download_name = st.selectbox(
            "下载小说书名的格式",
            ["FULL", "IN", "OUT"],
            index=index_map.get(download_choice, 0),
        )
        with st.container(border=True):
            st.write("以 `败北女角太多了！(败犬女主太多了！)` 为例")
            col1, col2 = st.columns(2)
            with col1:
                st.write("**FULL**")
                st.write("**IN**")
                st.write("**OUT**")
            with col2:
                st.write("`败北女角太多了！(败犬女主太多了！)`")
                st.write("`败犬女主太多了！`")
                st.write("`败北女角太多了！`")

        st.divider()
        st.subheader("封面图片")
        cover_index = st.text_input(
            "封面图片索引",
            value=config.get("download", "default_cover_index"),
            help="0 表示第一张插图，1 表示第二张，依此类推",
        )

        feedback_download = st.empty()
        if st.button("💾 保存下载设置", use_container_width=True, type="primary"):
            if not str.isdigit(str(cover_index)):
                st.error("封面图片的索引必须为整数")
            else:
                config.set("download", "full_title", download_name)
                config.set("download", "default_cover_index", int(cover_index))
                with feedback_download:
                    st.success("✅ 下载设置已保存！")



def full_volumes_download_page() -> None:
    """整本下载页面：输入书号后将整本小说下载为单个 EPUB 文件。"""
    st.title("整本下载")
    col_input, col_btn = st.columns([6, 1], vertical_alignment="bottom")
    info_container = st.container()
    button_container = st.container()
    status_bar = st.container()

    book = st.session_state.book

    with col_input:
        book_id = _parse_book_id_input(
            st.text_input(
                "请输入轻小说文库的作品编号或链接",
                help="例如：3057 或 https://www.wenku8.net/book/3057.htm",
            )
        )

    with col_btn:
        if st.button("查询信息"):
            if not book_id:
                st.warning("⚠️ 请输入有效的纯数字编号或轻小说文库书籍链接！")
            else:
                with status_bar:
                    with st.spinner("正在查询中..."):
                        if safe_get_book_id() != book_id:
                            try:
                                book = Book(book_id)
                                update_session(book)
                            except Exception as e:
                                st.error(f"❌ 获取书籍信息失败: {e}")
                                st.stop()
                        else:
                            book = st.session_state.book

    if book is not None:
        with info_container:
            with st.spinner("Wait for it..."):
                show_book_info(book, st.container())
        with button_container:
            if st.button("下载", use_container_width=True):
                downloader.download_novel(book, status_bar)


def divided_volumes_download_page() -> None:
    """分卷下载页面：选择指定卷后下载为独立的 EPUB 文件。"""
    st.title("分卷下载")
    col_input, col_btn = st.columns([6, 1], vertical_alignment="bottom")
    select_box = st.container()
    status_bar = st.container()

    book = st.session_state.book

    with col_input:
        book_id = _parse_book_id_input(
            st.text_input(
                "请输入轻小说文库的作品编号或链接",
                help="例如：3057 或 https://www.wenku8.net/book/3057.htm",
            )
        )

    with col_btn:
        if st.button("查看信息"):
            if not book_id:
                st.warning("⚠️ 请输入有效的纯数字编号或轻小说文库书籍链接！")
            else:
                with status_bar:
                    with st.spinner("正在查询中..."):
                        if safe_get_book_id() != book_id:
                            try:
                                book = Book(book_id)
                                update_session(book)
                            except Exception as e:
                                st.error(f"❌ 获取书籍信息失败: {e}")
                                st.stop()
                        else:
                            book = st.session_state.book

    if book is not None:
        with select_box:
            col_cover, col_info = st.columns([1, 3])
            with col_cover:
                st.image(book.basic_info["cover"])
            with col_info:
                st.subheader(book.basic_info["标题"])
                selected = st.selectbox("选择要下载的卷", book.volumes.keys())
                st.write("")
                if st.button(
                    "下载",
                    use_container_width=True,
                    help="默认会以第一张插图作为封面，可在配置页面修改",
                ):
                    downloader.download_novel(book, status_bar, selected)


def picture_download_page() -> None:
    """图片下载页面：按卷或全书下载插图到本地文件夹。"""
    st.title("图片下载")
    col_input, col_btn = st.columns([6, 1], vertical_alignment="bottom")
    select_box = st.container()
    status_bar = st.container()

    book = st.session_state.book

    with col_input:
        book_id = _parse_book_id_input(
            st.text_input(
                "请输入轻小说文库的作品编号或链接",
                help="例如：3057 或 https://www.wenku8.net/book/3057.htm",
            )
        )

    with col_btn:
        if st.button("查看图片"):
            if not book_id:
                st.warning("⚠️ 请输入有效的纯数字编号或轻小说文库书籍链接！")
            else:
                with status_bar:
                    with st.spinner("正在查询中..."):
                        if safe_get_book_id() != book_id:
                            try:
                                book = Book(book_id)
                                update_session(book)
                            except Exception as e:
                                st.error(f"❌ 获取书籍信息失败: {e}")
                                st.stop()
                        else:
                            book = st.session_state.book

    if book is not None:
        with select_box:
            col_cover, col_info = st.columns([1, 3])
            with col_cover:
                st.image(book.basic_info["cover"])
            with col_info:
                st.subheader(book.basic_info["标题"])
                selected = st.selectbox("选择要下载的卷", book.volumes.keys())
                st.write("")

                _, col_single, col_all = st.columns([1, 2, 2])

                with col_single:
                    if st.button("单卷下载"):
                        with status_bar:
                            urls = book.get_chapter_image_urls(volume_name=selected)
                            downloader.download_pictures(
                                urls, selected, book.basic_info["标题"], status_bar
                            )
                            st.success("下载完成")

                with col_all:
                    if st.button("全部下载"):
                        with status_bar:
                            start = time.time()
                            for idx, volume in enumerate(book.picture_urls, start=1):
                                ch_urls = book.get_chapter_image_urls(volume)
                                downloader.download_pictures(
                                    ch_urls,
                                    volume,
                                    book.basic_info["标题"],
                                    st.container(),
                                    idx,
                                )
                            elapsed = time.strftime(
                                "%M 分 %S 秒", time.gmtime(time.time() - start)
                            )
                            st.success(f"下载完成，共耗时：{elapsed}")


def search_by_author_page() -> None:
    """按作者搜索页面：输入作者名，展示搜索结果，可跳转详情。"""
    st.title("按作者搜索")
    col_input, col_btn = st.columns([6, 1], vertical_alignment="bottom")
    select_container = st.container()
    info_container = st.container()

    show_books = st.session_state.author_search

    with col_input:
        author = st.text_input("请输入轻小说文库的作者", help="例如：橘公司").strip()

    with col_btn:
        if st.button("查询信息"):
            with info_container:
                with st.spinner("正在查询中..."):
                    try:
                        show_books = crawler.search(author, "author")
                        st.session_state.author_search = show_books
                        if not show_books:
                            st.error("未找到相关作品")
                    except Exception as e:
                        if "403" in str(e):
                            st.error("❌ 网站访问被拒绝（403）。\n\n可能原因：\n- Cookie 已过期，请到「配置」页面点击「更新 Cookie」\n- 当前网络 IP 被网站封禁，请尝试更换网络或使用代理")
                        else:
                            st.error(f"查询失败：{e}")

    if show_books:
        _render_search_results(show_books, select_container)


def search_by_title_page() -> None:
    """按书名搜索页面：输入书名，展示搜索结果，可跳转详情。"""
    st.title("按书名搜索")
    col_input, col_btn = st.columns([6, 1], vertical_alignment="bottom")
    select_container = st.container()
    info_container = st.container()

    show_books = st.session_state.title_search

    with col_input:
        title = st.text_input("请输入轻小说文库的作品名称", help="例如：败犬女主").strip()

    with col_btn:
        if st.button("查询信息"):
            with info_container:
                with st.spinner("正在查询中..."):
                    try:
                        show_books = crawler.search(title, "articlename")
                        st.session_state.title_search = show_books
                        if not show_books:
                            st.error("未找到相关作品")
                    except Exception as e:
                        if "403" in str(e):
                            st.error("❌ 网站访问被拒绝（403）。\n\n可能原因：\n- Cookie 已过期，请到「配置」页面点击「更新 Cookie」\n- 当前网络 IP 被网站封禁，请尝试更换网络或使用代理")
                        else:
                            st.error(f"查询失败：{e}")

    if show_books:
        _render_search_results(show_books, select_container)


def search_by_id_page() -> None:
    """编号检索页面：输入书籍编号或链接，展示详情及下载入口。"""
    st.title("编号检索")
    col_input, col_btn = st.columns([6, 1], vertical_alignment="bottom")
    info_container = st.container()
    jump_container = st.container(border=True)

    with col_input:
        book_id = _parse_book_id_input(
            st.text_input(
                "请输入轻小说文库的作品编号或链接",
                help="例如：3057 或 https://www.wenku8.net/book/3057.htm",
            )
        )

    with col_btn:
        if st.button("查询信息"):
            if not book_id:
                st.warning("⚠️ 请输入有效的纯数字编号或轻小说文库书籍链接！")
            else:
                with info_container:
                    with st.spinner("正在查询中..."):
                        if safe_get_book_id() != book_id:
                            try:
                                book = Book(book_id)
                                update_session(book)
                            except Exception as e:
                                st.error(f"❌ 获取书籍信息失败: {e}")
                                st.stop()

    if st.session_state.book is not None:
        book = st.session_state.book
        with info_container:
            with st.spinner("Wait for it..."):
                show_book_info(book, st.container())
                st.write("**简介：**")
                for line in book.basic_info.get("简介", "").split("\n"):
                    st.write(line)

        # 快捷跳转到下载页
        with jump_container:
            col_full, _, col_vol, _, col_pic = st.columns(
                [1, 1, 1, 1, 1], vertical_alignment="center"
            )
            with col_full:
                st.page_link(
                    st.Page(full_volumes_download_page),
                    label="整本下载",
                    icon=":material/collections_bookmark:",
                )
            with col_vol:
                st.page_link(
                    st.Page(divided_volumes_download_page),
                    label="分卷下载",
                    icon=":material/library_books:",
                )
            with col_pic:
                st.page_link(
                    st.Page(picture_download_page),
                    label="图片下载",
                    icon=":material/image_search:",
                )


# ==================================================================
# 辅助函数
# ==================================================================

def _parse_book_id_input(raw: str) -> str:
    """
    从用户输入中提取书籍编号。

    支持直接输入数字编号（如 "3057"）或完整书籍页链接
    （如 "https://www.wenku8.net/book/3057.htm"）。

    :param raw: 用户原始输入字符串
    :return: 纯数字书籍编号字符串，若无法匹配则返回空字符串
    """
    import re
    raw = raw.strip()
    if not raw:
        return ""
        
    # 尝试正则匹配由于包含 https 或 http 等导致的长串，提取其中的 \d+
    match = re.search(r"wenku8\.net/book/(\d+)\.htm", raw)
    if match:
        return match.group(1)
        
    # 若直接纯数字（长度通常不超过10位）
    if raw.isdigit():
        return raw
        
    return ""


def _render_search_results(show_books: List[dict], select_container) -> None:
    """
    渲染搜索结果：顶部下拉框用于选择并跳转，下方列表展示所有结果。

    :param show_books: 搜索结果列表，格式同 WebCrawler.search 的返回值
    :param select_container: 放置下拉框和跳转按钮的 Streamlit 容器
    """
    book_titles = [item["title"] for item in show_books]

    with select_container:
        col_select, col_jump = st.columns([3, 1], vertical_alignment="bottom")
        with col_select:
            selected = st.selectbox("选择要查看的作品", book_titles)
        with col_jump:
            if st.button("查看信息"):
                for item in show_books:
                    if item["title"] == selected:
                        try:
                            with st.spinner("正在获取书籍信息..."):
                                book = Book(item["id"])
                                update_session(book)
                        except Exception as e:
                            st.error(f"❌ 查阅获取失败：{e}")
                            st.stop()
                        break
                st.switch_page(st.Page(search_by_id_page))

    # 列表展示所有结果
    for item in show_books:
        with st.container():
            col_cover, col_info = st.columns([1, 3])
            with col_cover:
                st.image(item["cover"])
            with col_info:
                st.write(f"<h3>{item['title']}</h3>", unsafe_allow_html=True)
                st.write("---")
                st.write(f"编号：{item['id']}")
            st.write("---")


def show_book_info(book: Book, container) -> None:
    """
    在指定容器中显示书籍的封面和基本信息表格。

    :param book: Book 实例
    :param container: Streamlit 容器对象
    """
    with container:
        col_cover, col_info = st.columns([3, 5], vertical_alignment="bottom")
        with col_cover:
            st.image(book.basic_info["cover"])
        with col_info:
            st.subheader(book.basic_info["标题"])
            col_key, col_val = st.columns([2, 7])
            # 过滤掉不需要在表格中展示的键
            skip_keys = {"cover", "标题", "简介"}
            for key, value in book.basic_info.items():
                if key in skip_keys:
                    continue
                col_key.write(f"**{key}：**")
                col_val.write(value)


def update_session(book: Book) -> None:
    """
    清空当前 Session State 并写入新的书籍数据。

    切换书籍时调用，确保各页面展示的数据与当前查询一致。

    :param book: 新的 Book 实例
    """
    # 清空所有旧状态，避免上一本书的数据残留
    for key in list(st.session_state.keys()):
        del st.session_state[key]

    st.session_state.book = book
    st.session_state.multiselect = list(book.volumes.keys())


def safe_get_book_id() -> str:
    """
    安全地获取当前 Session 中书籍的 ID。

    :return: 当前书籍的 book_id；Session 中无书籍时返回空字符串
    """
    if st.session_state.book is not None:
        return getattr(st.session_state.book, "book_id", "")
    return ""


def _init_session() -> None:
    """
    初始化 Streamlit Session State 中的各项默认值。

    应在每次页面渲染前调用，确保所需键均已存在。
    """
    defaults = {
        "book": None,
        "multiselect": None,
        "title_search": [],
        "author_search": [],
    }
    for key, default_value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = default_value


# ==================================================================
# 应用入口
# ==================================================================

if __name__ == "__main__":
    # 页面路由配置
    pages = {
        "基本": [
            st.Page(home_page, title="主页", icon=":material/home:"),
            st.Page(config_page, title="配置", icon=":material/settings:"),
        ],
        "查询": [
            st.Page(search_by_id_page, title="编号检索", icon=":material/123:"),
            st.Page(search_by_author_page, title="作者检索", icon=":material/person:"),
            st.Page(search_by_title_page, title="书名检索", icon=":material/book:"),
        ],
        "下载": [
            st.Page(
                full_volumes_download_page,
                title="整本下载",
                icon=":material/collections_bookmark:",
            ),
            st.Page(
                divided_volumes_download_page,
                title="分卷下载",
                icon=":material/library_books:",
            ),
            st.Page(
                picture_download_page,
                title="图片下载",
                icon=":material/image_search:",
            ),
        ],
        # 调试页面（开发时取消注释）
        # "调试": [
        #     st.Page(debug_page, title="调试", icon=":material/bug_report:")
        # ],
    }

    _init_session()
    pg = st.navigation(pages)
    pg.run()

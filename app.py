import os
import time

import streamlit as st

from tools.book import Book
from tools.config_manager import ConfigManager
from tools.crawler import WebCrawler
from tools.downloader import Downloader

config = ConfigManager()
crawler = WebCrawler()
downloader = Downloader()


def home_page():
    st.title("🎉Welcome !")

    # 加入一些emoji
    st.subheader("简介")
    st.write(
        "欢迎使用轻小说文库epub下载器，本工具基于[轻小说文库](https://www.wenku8.net/)和[Streamlit](https://streamlit.io/)构建。可以用于下载轻小说文库的小说并保存为epub格式。")
    st.image(os.path.join(os.getcwd(), 'docs', 'pics', 'search_page.png'))
    st.page_link(st.Page(search_by_id_page), label="开始使用", icon=":material/arrow_forward:",
                 use_container_width=True)
    st.write("**功能列表**")
    st.write("- ✅ 查询文库中的小说信息（支持按编号、书名、作者查询）")
    st.write("- ✅ 下载整本小说或分卷下载")
    st.write("- ✅ 单独下载小说插图")
    st.write("- ✅ 支持配置下载选项")

    st.write("")

    st.write("**注意事项**")
    st.write("- ❗ 本工具仅用于学习交流，请勿滥用，遵守相关法律法规")
    st.write("- ⚠️ 暂不支持下载已下架小说")

    st.write("")


    st.write("**关于**")
    st.write(
        "如果有任何问题或建议，欢迎在GitHub上提出。如果觉得好用，欢迎给个Star⭐。")
    st.page_link("https://github.com/mj3622/Wenku8Downloader", label="GitHub 项目地址", icon=":material/link:",
                 use_container_width=True)


def config_page():
    """
    配置页面
    :return:
    """
    st.title("配置")
    username = st.text_input('请输入轻小说文库的用户名', config.get('login', 'username'),
                             help="当共享账号出现问题时，可以切换为自己的账号")
    password = st.text_input('请输入轻小说文库的密码', config.get('login', 'password'), type='password')

    download_choice = config.get('download', 'full_title')

    index_map = {'FULL': 0, 'IN': 1, 'OUT': 2}

    download_name = st.selectbox('下载小说书名的格式', ['FULL', 'IN', 'OUT'], index=index_map[download_choice])

    with st.container(border=True):
        st.write('以 `败北女角太多了！(败犬女主太多了！)` 为例')
        st.write('FULL: `败北女角太多了！(败犬女主太多了！)`')
        st.write('IN: `败犬女主太多了！`')
        st.write('OUT: `败北女角太多了！`')

    cover_index = st.text_input('封面图片的索引', config.get('download', 'default_cover_index'),
                                help="默认为0，即第一张插图", type='default')

    t1, c1, c2, t2 = st.columns([1, 4, 2, 1], vertical_alignment='center')

    container = st.container()

    with c1:
        if st.button("保存信息"):
            if not str.isdigit(cover_index):
                st.error("封面图片的索引必须为整数")
                return

            config.set('login', 'username', username)
            config.set('login', 'password', password)
            config.set('download', 'full_title', download_name)
            config.set('download', 'default_cover_index', int(cover_index))
            with container:
                st.success("保存成功")
    with c2:
        if st.button("更新cookie"):
            with container:
                with st.spinner('正在更新cookie...'):
                    crawler.get_cookie()
                    st.success("Cookie更新成功")


def full_volumes_download_page():
    """
    整本下载页面
    :return:
    """
    st.title("整本下载")
    c1, c2 = st.columns([6, 1], vertical_alignment='bottom')

    info_container = st.container()
    button_container = st.container()
    status_bar = st.container()

    book = st.session_state.book

    with c1:
        id = st.text_input('请输入轻小说文库的作品编号或链接', help="例如：3057 或 https://www.wenku8.net/book/3057.htm")

        if id.startswith('https://www.wenku8.net/book/'):
            id = id.split('/')[-1].split('.')[0]

    with c2:
        if st.button("查询信息"):
            with status_bar:
                with st.spinner('正在查询中...'):
                    if safe_get_book_id() == id:
                        book = st.session_state.book
                    else:
                        book = Book(id)
                        update_session(book)
    if book is not None:
        with info_container:
            with st.spinner('Wait for it...'):
                show_container = st.container()
                show_book_info(book, show_container)

        with button_container:
            if st.button("下载", use_container_width=True):
                downloader.download_novel(book, status_bar)
                st.success("下载完成")


def divided_volumes_download_page():
    """
    分卷下载页面
    :return:
    """
    st.title("分卷下载")
    c1, c2 = st.columns([6, 1], vertical_alignment='bottom')

    select_box = st.container()
    status_bar = st.container()

    book = st.session_state.book

    with c1:
        id = st.text_input('请输入轻小说文库的作品编号或链接', help="例如：3057 或 https://www.wenku8.net/book/3057.htm")

        if id.startswith('https://www.wenku8.net/book/'):
            id = id.split('/')[-1].split('.')[0]

    with c2:
        if st.button("查看信息"):
            with status_bar:
                with st.spinner('正在查询中...'):
                    if safe_get_book_id() == id:
                        book = st.session_state.book
                    else:
                        book = Book(id)
                        update_session(book)

    if book is not None:
        with select_box:
            c_s1, c_s2 = st.columns([1, 3])
            with c_s1:
                st.image(book.basic_info['cover'])
            with c_s2:
                st.subheader(book.basic_info['标题'])

                selected = st.selectbox('选择要下载的卷', book.volumes.keys())

                st.write('')
                st.write('')
                st.write('')

                if st.button("下载", use_container_width=True, help="默认会以第一张插图作为封面，可在配置页面修改"):
                    downloader.download_novel(book, status_bar, selected)


def picture_download_page():
    """
    图片下载页面
    :return:
    """
    st.title("图片下载")
    c1, c2 = st.columns([6, 1], vertical_alignment='bottom')

    select_box = st.container()
    status_bar = st.container()

    book = st.session_state.book

    with c1:
        id = st.text_input('请输入轻小说文库的作品编号或链接', help="例如：3057 或 https://www.wenku8.net/book/3057.htm")

        if id.startswith('https://www.wenku8.net/book/'):
            id = id.split('/')[-1].split('.')[0]

    with c2:
        if st.button("查看图片"):
            with status_bar:
                with st.spinner('正在查询中...'):
                    if safe_get_book_id() == id:
                        book = st.session_state.book
                    else:
                        book = Book(id)
                        update_session(book)

    if book is not None:
        with select_box:
            c_s1, c_s2 = st.columns([1, 3])
            with c_s1:
                st.image(book.basic_info['cover'])
            with c_s2:
                st.subheader(book.basic_info['标题'])

                selected = st.selectbox('选择要下载的卷', book.volumes.keys())
                st.write('')
                st.write('')
                st.write('')

                t0, c11, c12 = st.columns([1, 2, 2])

                with c11:
                    if st.button("单卷下载"):
                        with status_bar:
                            urls = book.get_chapter_image_urls(volume_name=selected)
                            downloader.download_pictures(urls, selected, book.basic_info['标题'], status_bar)
                            st.success("下载完成")

                with c12:
                    if st.button("全部下载"):
                        with status_bar:
                            start = time.time()
                            for i, (volume, url) in enumerate(book.picture_urls.items(), start=1):
                                print(f"Downloading {volume}...")
                                ch_urls = book.get_chapter_image_urls(volume)
                                t_container = st.container()
                                downloader.download_pictures(ch_urls, volume, book.basic_info['标题'], t_container, i)
                            st.success("下载完成，共耗时：" + time.strftime("%M分%S秒", time.gmtime(time.time() - start)))


def search_by_author_page():
    """
    按作者搜索
    :return:
    """
    st.title("按作者搜索")
    c1, c2 = st.columns([6, 1], vertical_alignment='bottom')

    select_container = st.container()
    info_container = st.container()
    show_books = st.session_state.author_search

    with c1:
        author = st.text_input('请输入轻小说文库的作者', help="例如：橘公司")
        author.strip()

    with c2:
        if st.button("查询信息"):
            with info_container:
                with st.spinner('正在查询中...'):
                    show_books = crawler.search(author, 'author')
                    st.session_state.author_search = show_books
                    if not show_books:
                        st.error("未找到相关作品")

    if len(show_books) > 0:
        author_list = [item['title'] for item in show_books]
        with select_container:
            cs_1, cs_2 = st.columns([3, 1], vertical_alignment='bottom')

            with cs_1:
                selected = st.selectbox('选择要查看的作品', author_list)

            with cs_2:
                if st.button("查看信息"):
                    for item in show_books:
                        if item['title'] == selected:
                            book = Book(item['id'])
                            update_session(book)
                    st.switch_page(st.Page(search_by_id_page))

        for item in show_books:
            with st.container():
                ct1, ct2 = st.columns([1, 3])
                with ct1:
                    st.image(item['cover'])
                with ct2:
                    st.write(f"<h3>{item['title']}</h3>", unsafe_allow_html=True)
                    st.write('---')
                    st.write(f"编号：{item['id']}")
                st.write('---')


def search_by_title_page():
    """
    按书名搜索
    :return:
    """
    st.title("按书名搜索")
    c1, c2 = st.columns([6, 1], vertical_alignment='bottom')

    select_container = st.container()
    info_container = st.container()
    show_books = st.session_state.title_search

    with c1:
        title = st.text_input('请输入轻小说文库的作品名称', help="例如：败犬女主")
        title.strip()

    with c2:
        if st.button("查询信息"):
            with info_container:
                with st.spinner('正在查询中...'):
                    show_books = crawler.search(title, 'articlename')
                    st.session_state.title_search = show_books
                    if not show_books:
                        st.error("未找到相关作品")

    if len(show_books) > 0:
        title_list = [item['title'] for item in show_books]
        with select_container:
            cs_1, cs_2 = st.columns([3, 1], vertical_alignment='bottom')

            with cs_1:
                selected = st.selectbox('选择要查看的作品', title_list)

            with cs_2:
                if st.button("查看信息"):
                    for item in show_books:
                        if item['title'] == selected:
                            book = Book(item['id'])
                            update_session(book)
                    st.switch_page(st.Page(search_by_id_page))

        for item in show_books:
            with st.container():
                ct1, ct2 = st.columns([1, 3])
                with ct1:
                    st.image(item['cover'])
                with ct2:
                    st.write(f"<h3>{item['title']}</h3>", unsafe_allow_html=True)
                    st.write('---')
                    st.write(f"编号：{item['id']}")
                st.write('---')


def search_by_id_page():
    st.title("编号搜索")

    c1, c2 = st.columns([6, 1], vertical_alignment='bottom')
    info_container = st.container()
    jump_container = st.container(border=True)

    with c1:
        id = st.text_input('请输入轻小说文库的作品编号或链接',
                           help="例如：3057 或 https://www.wenku8.net/book/3057.htm")

        if id.startswith('https://www.wenku8.net/book/'):
            id = id.split('/')[-1].split('.')[0]

    with (c2):
        if st.button("查询信息"):
            with info_container:
                with st.spinner('正在查询中...'):
                    if safe_get_book_id() != id:
                        book = Book(id)
                        update_session(book)

    if st.session_state.book is not None:
        with info_container:
            book = st.session_state.book
            result = book.basic_info
            description = result.get('简介')

            with st.spinner('Wait for it...'):
                # 左边显示封面，右边显示信息
                show_container = st.container()
                show_book_info(book, show_container)
                st.write('**简介：**')

                for e in description.split('\n'):
                    st.write(e)

        with jump_container:
            b1, t1, b2, t2, b3 = st.columns([1, 1, 1, 1, 1], vertical_alignment='center')

            with b1:
                st.page_link(st.Page(full_volumes_download_page), label="整本下载",
                             icon=":material/collections_bookmark:")
            with b2:
                st.page_link(st.Page(divided_volumes_download_page), label="分卷下载",
                             icon=":material/library_books:")
            with b3:
                st.page_link(st.Page(picture_download_page), label="图片下载", icon=":material/image_search:")


def debug_page():
    st.title("调试")
    st.write("**本页面用于调试，如有需要可以在app.py中更新debug_page函数**")


def update_session(book):
    for key in st.session_state.keys():
        del st.session_state[key]

    st.session_state.book = book
    st.session_state.multiselect = list(book.volumes.keys())


def safe_get_book_id():
    if st.session_state.book is not None:
        return getattr(st.session_state.book, 'book_id', -1)
    return -1


def show_book_info(book, container):
    """
    显示书籍的基本信息
    :param book: 一个Book对象
    :param container: 显示的容器
    :return:
    """
    with container:
        pic_col, info_col = st.columns([3, 5], vertical_alignment='bottom')
        with pic_col:
            st.image(book.basic_info['cover'])
        with info_col:
            st.subheader(book.basic_info['标题'])
            key_col, value_col = st.columns([2, 7])
            for key, value in book.basic_info.items():
                if key == 'cover' or key == '标题' or key == '简介':
                    continue
                key_col.write('**' + key + '：**')
                value_col.write(value)


def encode_key(key):
    """
    将关键字编码为URL编码
    :param key: 待编码的关键字
    :return: 编码后的字符串
    """
    encoded_bytes = key.encode('gbk')
    return ''.join([f'%{byte:02x}' for byte in encoded_bytes])


def init():
    """
    初始化函数
    :return:
    """
    if 'book' not in st.session_state:
        st.session_state.book = None
    if 'multiselect' not in st.session_state:
        st.session_state.multiselect = None

    if 'title_search' not in st.session_state:
        st.session_state.title_search = []

    if 'author_search' not in st.session_state:
        st.session_state.author_search = []


if __name__ == "__main__":
    pages = {
        '基本': [
            st.Page(home_page, title='主页', icon=":material/home:"),
            st.Page(config_page, title='配置', icon=":material/settings:")
        ],
        '查询': [
            st.Page(search_by_id_page, title='编号检索', icon=":material/123:"),
            st.Page(search_by_author_page, title='作者检索', icon=":material/person:"),
            st.Page(search_by_title_page, title='书名检索', icon=":material/book:")
        ],
        '下载': [
            st.Page(full_volumes_download_page, title='整本下载', icon=":material/collections_bookmark:"),
            st.Page(divided_volumes_download_page, title='分卷下载', icon=":material/library_books:"),
            st.Page(picture_download_page, title='图片下载', icon=":material/image_search:")
        ],
        # 调试页面
        # '调试': [
        #     st.Page(debug_page, title='调试', icon=":material/bug_report:")
        # ]
    }

    init()

    pg = st.navigation(pages)
    pg.run()

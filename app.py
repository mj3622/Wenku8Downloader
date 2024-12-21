import time

import streamlit as st
from tools.config_manager import ConfigManager
from tools.crawler import WebCrawler
from tools.book import Book
from tools.downloader import Downloader

config = ConfigManager()
crawler = WebCrawler()
downloader = Downloader()


def home_page():
    st.title("轻小说文库epub下载器")


def config_page():
    st.title("配置")
    username = st.text_input('请输入轻小说文库的用户名', config.get('login', 'username'),
                             help="当共享账号出现问题时，可以切换为自己的账号")
    password = st.text_input('请输入轻小说文库的密码', config.get('login', 'password'), type='password')

    t1, c1, c2, t2 = st.columns([1, 4, 2, 1], vertical_alignment='center')

    container = st.container()

    with c1:
        if st.button("保存信息"):
            config.set('login', 'username', username)
            config.set('login', 'password', password)
            st.success("保存成功")
    with c2:
        if st.button("更新cookie"):
            with container:
                with st.spinner('正在更新cookie...'):
                    crawler.get_cookie()
                    st.success("Cookie更新成功")


def full_volumes_download_page():
    st.title("全卷下载")
    # TODO: 整卷下载


def divided_volumes_download_page():
    # TODO: 分卷下载
    c1, c2 = st.columns([6, 1], vertical_alignment='bottom')
    st.title("分卷下载")

    st.text_input('请输入轻小说文库的作品编号或链接',
                  help="例如：3057 或 https://www.wenku8.net/book/3057.htm")


def picture_download_page():
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


def search_by_author():
    st.title("按作者搜索")
    # TODO: 按作者搜索


def search_by_keywords():
    # TODO: 按关键字搜索
    st.title("关键字搜索")


def search_by_id():
    st.title("编号搜索")

    c1, c2 = st.columns([6, 1], vertical_alignment='bottom')
    info_container = st.container()
    jump_container = st.container(border=True)

    with c1:
        id = st.text_input('请输入轻小说文库的作品编号或链接', '3057',
                           help="例如：3057 或 https://www.wenku8.net/book/3057.htm")

        if id.startswith('https://www.wenku8.net/book/'):
            id = id.split('/')[-1].split('.')[0]

    with (c2):
        if st.button("查询信息"):
            with info_container:
                with st.spinner('正在查询中...'):
                    if safe_get_book_id() == id:
                        book = st.session_state.book
                    else:
                        book = Book(id)
                        update_session(book)

                    result = book.basic_info
                    description = result.get('简介')
                    result.pop('简介')
                    with st.spinner('Wait for it...'):
                        # 左边显示封面，右边显示信息
                        pic_col, info_col = st.columns([3, 5], vertical_alignment='bottom')
                        with pic_col:
                            st.image(result['cover'])
                        with info_col:
                            st.subheader(result['标题'])
                            key_col, value_col = st.columns([2, 7])
                            for key, value in result.items():
                                if key == 'cover' or key == '标题':
                                    continue
                                key_col.write('**' + key + '：**')
                                value_col.write(value)
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
    id = st.text_input('请输入轻小说文库的作品编号或链接', '3057',
                       help="例如：3057 或 https://www.wenku8.net/book/3057.htm")

    if st.button("查询信息"):
        result = Book(id).get_chapter_image_urls('第一卷')
        for url in result:
            st.image(crawler.parse_chapter(url))


def update_session(book):
    print("Updating session...")
    for key in st.session_state.keys():
        del st.session_state[key]

    st.session_state.book = book
    st.session_state.multiselect = list(book.volumes.keys())


def safe_get_book_id():
    if st.session_state.book is not None:
        return getattr(st.session_state.book, 'book_id', -1)
    return -1


def init():
    if 'book' not in st.session_state:
        st.session_state.book = None
    if 'multiselect' not in st.session_state:
        st.session_state.multiselect = None


if __name__ == "__main__":
    pages = {
        '基本': [
            st.Page(home_page, title='主页', icon=":material/home:"),
            st.Page(config_page, title='配置', icon=":material/settings:")
        ],
        '查询': [
            st.Page(search_by_id, title='编号检索', icon=":material/123:"),
            st.Page(search_by_author, title='作者检索', icon=":material/person:"),
            st.Page(search_by_keywords, title='关键词检索', icon=":material/key_vertical:")
        ],
        '下载': [
            st.Page(full_volumes_download_page, title='整本下载', icon=":material/collections_bookmark:"),
            st.Page(divided_volumes_download_page, title='分卷下载', icon=":material/library_books:"),
            st.Page(picture_download_page, title='图片下载', icon=":material/image_search:")
        ],
        '调试': [
            st.Page(debug_page, title='调试', icon=":material/bug_report:")
        ]
    }

    init()

    pg = st.navigation(pages)
    pg.run()

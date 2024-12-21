import os
import time

import requests
import streamlit as st

SAVE_PATH = os.path.join(os.getcwd(), 'downloads')
PIC_PATH = os.path.join(SAVE_PATH, 'pics')
NOVEL_PATH = os.path.join(SAVE_PATH, 'novels')


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

        headers = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,/;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
            'Cache-Control': 'max-age=0',
            'If-None-Match': '"6944BEA576E56CA6D655A7D7F0A066F7"',
            'Priority': 'u=0, i',
            'Referer': 'https://www.wenku8.net/',
            'Sec-CH-UA': '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            'Sec-CH-UA-Mobile': '?0',
            'Sec-CH-UA-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'cross-site',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
        }

        with progress_container:
            bar = st.progress(0)
            for i, url in enumerate(urls):
                bar.progress(i / len(urls), f"⏬ 正在下载 {volume_name} 第{i + 1}/{len(urls)}张图片...")
                suffix = url.split('.')[-1]
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
                    file_path = f"{volume_path}/{i + 1}.{suffix}"
                    with open(file_path, 'wb') as f:
                        f.write(response.content)
                    time.sleep(0.2)

            bar.progress(1.0, "✅ 下载完成")

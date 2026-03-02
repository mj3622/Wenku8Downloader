"""
config_manager.py - 配置文件管理模块

负责读取和写入 TOML 格式的配置文件（config/secrets.toml）。
包含登录凭据、Cookie 和下载选项等配置项。
"""

import os

import toml

# 配置文件的绝对路径（相对于项目根目录）
_CONFIG_FILE_PATH = os.path.join(os.getcwd(), "config", "secrets.toml")

# 首次使用时写入的默认配置
_DEFAULT_CONFIG = {
    "cookie": {
        "PHPSESSID": "",
        "jieqiUserInfo": "",
        "jieqiVisitInfo": "",
        "cf_clearance": "",
    },
    "login": {
        "username": "",
        "password": "",
    },
    "proxy": {
        "http": "",
        "https": "",
    },
    "download": {
        "full_title": "FULL",
        "default_cover_index": 0,
    },
}


class ConfigManager:
    """
    配置管理器，封装对 TOML 配置文件的读写操作。

    配置文件不存在时，自动使用默认值创建。
    所有修改操作均会立即持久化到磁盘。
    """

    def __init__(self):
        self.file_path = _CONFIG_FILE_PATH

        # 若配置文件不存在，则自动从模板复制一份（保留文件中的注释说明）
        if not os.path.exists(self.file_path):
            example_path = self.file_path + ".example"
            if os.path.exists(example_path):
                import shutil

                shutil.copy(example_path, self.file_path)

        self.config = self._read_toml()

        # 若依然无法读取，使用默认值初始化并写入
        if not self.config:
            self.config = _DEFAULT_CONFIG.copy()
            self._write_toml()

    # ------------------------------------------------------------------
    # 私有方法
    # ------------------------------------------------------------------

    def _read_toml(self) -> dict:
        """
        读取 TOML 配置文件。

        :return: 配置字典；文件不存在时返回空字典
        """
        if os.path.exists(self.file_path):
            with open(self.file_path, "r", encoding="utf-8") as f:
                return toml.load(f)
        return {}

    def _write_toml(self) -> None:
        """将当前内存中的配置持久化到 TOML 文件。"""
        with open(self.file_path, "w", encoding="utf-8") as f:
            toml.dump(self.config, f)

    # ------------------------------------------------------------------
    # 公开方法
    # ------------------------------------------------------------------

    def get(self, section: str, key: str = None):
        """
        获取配置项的值。

        :param section: 配置节名称，如 "login"、"cookie"
        :param key: 节内键名；若为 None，则返回整个节
        :return: 对应的值；section 或 key 不存在时返回 None
        """
        if section not in self.config:
            return None
        if key is not None:
            return self.config[section].get(key)
        return self.config[section]

    def set(self, section: str, key: str, value) -> None:
        """
        设置配置项的值，并立即写入文件。

        :param section: 配置节名称
        :param key: 节内键名
        :param value: 要写入的值
        """
        if section not in self.config:
            self.config[section] = {}
        self.config[section][key] = value
        self._write_toml()

    def delete(self, section: str, key: str) -> None:
        """
        删除指定配置项，并立即写入文件。

        :param section: 配置节名称
        :param key: 节内键名
        """
        if section in self.config and key in self.config[section]:
            del self.config[section][key]
            self._write_toml()

    def get_all(self) -> dict:
        """返回完整的配置字典（只读引用）。"""
        return self.config

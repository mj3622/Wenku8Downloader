import toml
import os

file_path = os.path.join(os.getcwd(), 'secrets.toml')


class ConfigManager:
    def __init__(self):
        self.file_path = file_path
        self.config = self._read_toml()
        # 如果配置文件不存在，创建一个空的配置文件
        if not self.config:
            self._write_toml()

    def _read_toml(self):
        """读取 TOML 文件并返回内容，如果文件不存在，返回空字典"""
        if os.path.exists(self.file_path):
            with open(self.file_path, 'r') as f:
                return toml.load(f)
        else:
            return {}

    def _write_toml(self):
        """将当前的配置写入 TOML 文件"""
        with open(self.file_path, 'w') as f:
            toml.dump(self.config, f)

    def get(self, section, key=None):
        """获取配置项的值，支持通过 section 和 key 进行访问"""
        if section in self.config:
            if key:
                return self.config[section].get(key)
            return self.config[section]
        return None

    def set(self, section, key, value):
        """设置配置项的值，并保存到 TOML 文件"""
        if section not in self.config:
            self.config[section] = {}
        self.config[section][key] = value
        self._write_toml()

    def delete(self, section, key):
        """删除配置项"""
        if section in self.config and key in self.config[section]:
            del self.config[section][key]
            self._write_toml()

    def get_all(self):
        """获取所有配置数据"""
        return self.config

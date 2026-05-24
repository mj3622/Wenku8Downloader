#!/bin/bash
cd "$(dirname "$0")/.."
APP_PATH="release/mac/轻小说文库下载器.app"

if [ -d "$APP_PATH" ]; then
  echo "正在启动 轻小说文库下载器..."
  open "$APP_PATH"
else
  echo "错误：找不到 ${APP_PATH}"
  echo "请先运行: npm run build && electron-builder --mac --dir"
  echo "按任意键退出..."
  read -n 1
  exit 1
fi

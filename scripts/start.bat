@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set APP_PATH=release\win-unpacked\轻小说文库下载器.exe

if exist "%APP_PATH%" (
    echo 正在启动 轻小说文库下载器...
    start "" "%APP_PATH%"
) else (
    echo 错误：找不到 %APP_PATH%
    echo 请先运行: npm run build ^&^& electron-builder --win --dir
    pause
    exit /b 1
)

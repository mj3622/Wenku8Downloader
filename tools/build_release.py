import os
import sys
import platform
import shutil
import urllib.request
import zipfile
import tarfile
import subprocess
from pathlib import Path

# Releases configuration
# Note: we use python 3.10 as it's a good compromise for compatibility and feature set for Streamlit
PYTHON_WIN_URL = "https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip"
PYTHON_MAC_URL = "https://github.com/indygreg/python-build-standalone/releases/download/20240224/cpython-3.10.13+20240224-aarch64-apple-darwin-install_only.tar.gz"

BASE_DIR = Path(__file__).resolve().parent.parent
RELEASE_DIR = BASE_DIR / "release"
APP_NAME = "Wenku8Downloader"

def download_file(url: str, dest: Path):
    print(f"Downloading {url} ...")
    urllib.request.urlretrieve(url, dest)
    print("Download complete.")

def extract_archive(archive_path: Path, extract_to: Path):
    print(f"Extracting {archive_path.name} to {extract_to} ...")
    if archive_path.name.endswith(".zip"):
        with zipfile.ZipFile(archive_path, 'r') as zip_ref:
            zip_ref.extractall(extract_to)
    elif archive_path.name.endswith(".tar.gz") or archive_path.name.endswith(".tgz"):
        with tarfile.open(archive_path, "r:gz") as tar_ref:
            tar_ref.extractall(extract_to)
    print("Extraction complete.")

def install_python_windows(target_dir: Path):
    python_dir = target_dir / "python"
    python_dir.mkdir(parents=True, exist_ok=True)
    
    archive_path = target_dir / "python.zip"
    download_file(PYTHON_WIN_URL, archive_path)
    extract_archive(archive_path, python_dir)
    archive_path.unlink()

    # Get pip for embeddable python
    get_pip_url = "https://bootstrap.pypa.io/get-pip.py"
    get_pip_script = python_dir / "get-pip.py"
    download_file(get_pip_url, get_pip_script)

    # Modify pythonxx._pth to uncomment `import site`
    pth_file = next(python_dir.glob("python*._pth"), None)
    if pth_file:
        content = pth_file.read_text(encoding="utf-8")
        content = content.replace("#import site", "import site")
        pth_file.write_text(content, encoding="utf-8")

    python_exe = python_dir / "python.exe"
    subprocess.run([str(python_exe), str(get_pip_script)], check=True)
    get_pip_script.unlink()

def install_python_mac(target_dir: Path):
    archive_path = target_dir / "python.tar.gz"
    download_file(PYTHON_MAC_URL, archive_path)
    extract_archive(archive_path, target_dir) # Extracts to a 'python' folder within target_dir
    archive_path.unlink()

def setup_app_files(target_dir: Path):
    print("Copying application files...")
    # Directories/files to include in release
    include_paths = ["app.py", "requirements.txt", "tools", "docs"]
    
    for item in include_paths:
        src = BASE_DIR / item
        dst = target_dir / item
        if src.is_dir():
            shutil.copytree(src, dst, dirs_exist_ok=True)
        elif src.is_file():
            shutil.copy2(src, dst)
            
    # Include default configuration
    config_dir = target_dir / "config"
    config_dir.mkdir(exist_ok=True)
    shutil.copy2(BASE_DIR / "config" / "secrets.toml.example", config_dir / "secrets.toml.example")
    
    # Empty downloads folder
    (target_dir / "downloads").mkdir(exist_ok=True)

def install_dependencies(target_dir: Path, is_windows: bool):
    print("Installing python dependencies...")
    req_file = target_dir / "requirements.txt"
    if is_windows:
        python_exe = target_dir / "python" / "python.exe"
    else:
        python_exe = target_dir / "python" / "bin" / "python3"

    subprocess.run([str(python_exe), "-m", "pip", "install", "-r", str(req_file)], check=True)

    print("Downloading standalone Chromium via Playwright...")
    # Set the playwright browsers path to be within our standalone package
    env = os.environ.copy()
    browser_path = target_dir / "bin" / "browsers"
    env["PLAYWRIGHT_BROWSERS_PATH"] = str(browser_path.absolute())
    
    subprocess.run([str(python_exe), "-m", "playwright", "install", "chromium"], env=env, check=True)


def create_launch_scripts(target_dir: Path, is_windows: bool):
    print("Creating launch scripts...")
    if is_windows:
        script_path = target_dir / "start.bat"
        content = """@echo off
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0bin\browsers"
"%~dp0python\python.exe" -m streamlit run "%~dp0app.py"
pause
"""
        script_path.write_text(content, encoding="utf-8")
    else:
        script_path = target_dir / "start.command"
        content = """#!/bin/bash
cd "$(dirname "$0")"
export PLAYWRIGHT_BROWSERS_PATH="$(pwd)/bin/browsers"
./python/bin/python3 -m streamlit run app.py
"""
        script_path.write_text(content, encoding="utf-8")
        script_path.chmod(0o755)

def main():
    sys_platform = platform.system().lower()
    is_windows = sys_platform == "windows"
    
    # We allow overriding the target platform for GitHub Actions cross-compilation
    if len(sys.argv) > 1 and sys.argv[1] in ["windows", "macos"]:
       is_windows = sys.argv[1] == "windows" 
       
    platform_name = "Windows" if is_windows else "macOS"
    print(f"Starting build for {platform_name}...")

    if RELEASE_DIR.exists():
        print("Cleaning previous release directory...")
        shutil.rmtree(RELEASE_DIR)
        
    target_dir = RELEASE_DIR / f"{APP_NAME}-{platform_name}"
    target_dir.mkdir(parents=True)

    if is_windows:
        install_python_windows(target_dir)
    else:
        install_python_mac(target_dir)

    setup_app_files(target_dir)
    install_dependencies(target_dir, is_windows)
    create_launch_scripts(target_dir, is_windows)

    # Create final ZIP
    zip_name = RELEASE_DIR / f"{APP_NAME}-{platform_name}.zip"
    print(f"Creating Zip Archive: {zip_name.name} ...")
    shutil.make_archive(str(RELEASE_DIR / f"{APP_NAME}-{platform_name}"), 'zip', RELEASE_DIR, f"{APP_NAME}-{platform_name}")
    print("Done!")

if __name__ == "__main__":
    main()

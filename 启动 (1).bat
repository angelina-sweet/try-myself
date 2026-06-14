@echo off
chcp 65001 >nul
echo 正在启动背单词工具...
echo.

:: 检查 Python
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo 使用 Python 启动服务器...
    start http://localhost:8080
    python -m http.server 8080
) else (
    echo 未检测到 Python，尝试直接打开...
    start index.html
)

pause
#!/bin/bash
cd "$(dirname "$0")"
echo "正在启动背单词工具..."

# 检查 Python
if command -v python3 &> /dev/null; then
    echo "使用 Python 启动服务器..."
    open "http://localhost:8080"
    python3 -m http.server 8080
elif command -v python &> /dev/null; then
    echo "使用 Python 启动服务器..."
    open "http://localhost:8080"
    python -m http.server 8080
else
    echo "未检测到 Python，直接打开文件..."
    open index.html
fi
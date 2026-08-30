#!/bin/bash
# Clownfish 本地启动器（macOS）
# 用法：双击运行，或 ./serve.command
cd "$(dirname "$0")"
echo "=============================================="
echo "  🐟 Clownfish 像素肉鸽求生"
echo "  服务器已启动，浏览器访问:"
echo "  http://localhost:8000"
echo "  或直接双击 index.html 离线运行"
echo "  Ctrl+C 停止"
echo "=============================================="
python3 -m http.server 8000

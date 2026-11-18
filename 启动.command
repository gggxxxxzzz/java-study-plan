#!/bin/bash
# 双击启动：本地服务 + 浏览器
# 关掉这个终端窗口（或按 Ctrl+C）就停止服务。

cd "$(dirname "$0")" || exit 1

# 双击启动时 PATH 很干净，先把 Homebrew / 本地安装的 node 加进来
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "没找到 node。先装 Node.js（https://nodejs.org）再双击这个文件。"
  read -r -p "按回车关闭…"
  exit 1
fi

# 监听成功后由 server.js 自动打开浏览器
export JAVA_NOTES_OPEN=1

exec node server.js

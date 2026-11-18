@echo off
setlocal
chcp 65001 >nul
title Java 学习笔记 - 本地服务
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto no_node

echo.
echo  正在启动 Java 学习笔记...
echo  浏览器会自动打开：http://127.0.0.1:5271
echo  关掉这个窗口即可停止服务。
echo.
set "JAVA_NOTES_OPEN=1"
node server.js

echo.
echo  服务已退出。如果提示端口被占用，先关掉旧的启动窗口，再双击本文件。
pause
exit /b 0

:no_node
echo.
echo  没有找到 Node.js。
echo  请先安装 Node.js LTS（18 或更高）：https://nodejs.org/zh-cn
echo  安装时勾选 Add to PATH，装完重新双击本文件。
echo.
pause
exit /b 1

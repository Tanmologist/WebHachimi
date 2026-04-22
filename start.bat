@echo off
chcp 65001 >nul
title WebHachimi
cd /d "%~dp0"

echo.
echo ========================================
echo   WebHachimi - 本地同步服务
echo ========================================
echo.

REM 检测 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [警告] 未检测到 Node.js
    echo.
    echo 这台电脑还没有安装 Node.js，无法启动同步服务。
    echo.
    echo 请按下列任一方式处理：
    echo   1^) 下载安装 Node.js LTS  ^=^>  https://nodejs.org/
    echo      安装后重新双击本脚本即可
    echo   2^) 如果你正在用 AI Copilot 协作，告诉它：
    echo      "我没有 Node.js，请帮我把 WebHachimi 跑起来"
    echo      它会按 README.md 引导你完成安装
    echo.
    pause
    exit /b 1
)

REM 显示 Node 版本
for /f "delims=" %%v in ('node --version') do set NODE_VER=%%v
echo 已检测到 Node.js %NODE_VER%
echo.
echo 正在启动服务（浏览器会自动打开）...
echo.

node server.js

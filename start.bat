@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo 未找到 Node.js，请先安装: https://nodejs.org/
  pause
  exit /b 1
)
echo 正在启动 BiliPlayer...
node server.js --open
if errorlevel 1 pause

@echo off
chcp 65001 >nul
title 仙途 · 苍玄界 — AI 修仙 MUD
cd /d "%~dp0"
echo.
echo   ╔══════════════════════════════════════╗
echo   ║  仙途 · 苍玄界 — 正在开启天道之门…   ║
echo   ╚══════════════════════════════════════╝
echo.
if not exist config.json (
  echo  [错误] 缺少 config.json
  pause
  exit /b 1
)
start "" http://127.0.0.1:8787
node server.js
pause

@echo off
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"
title STORY QUIZ - Dashboard auto-watch (keep this window open)

where node >nul 2>nul
if errorlevel 1 goto NONODE

node "build-dashboard.js" --open --watch

echo.
echo   Watch stopped.
pause
exit /b 0

:NONODE
echo.
echo   [X] Node.js not found.
echo.
echo   This script needs Node.js. Install it once from https://nodejs.org
echo   ^(LTS version, default options^), then double-click this file again.
echo.
pause
exit /b 1

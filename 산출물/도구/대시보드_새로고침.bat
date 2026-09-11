@echo off
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"
title STORY QUIZ - Dashboard refresh

where node >nul 2>nul
if errorlevel 1 goto NONODE

node "build-dashboard.js" --open
if errorlevel 1 goto FAILED

echo.
echo   Done. Closing in 3 seconds...
timeout /t 3 >nul
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

:FAILED
echo.
echo   [X] Failed. Read the message above.
echo.
pause
exit /b 1

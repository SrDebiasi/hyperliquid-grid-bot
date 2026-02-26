@echo off
setlocal
title Hyperliquid Grid Bot - PM2 Logs
cd /d "%~dp0"

echo =======================================
echo  Hyperliquid Grid Bot - PM2 Logs
echo  Process: gridbot-1
echo  Tip: Ctrl+C to stop watching logs
echo =======================================
echo.

npx pm2 logs gridbot-1

echo.
echo Logs stopped. Press any key to close.
pause >nul
endlocal
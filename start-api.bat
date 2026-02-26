@echo off
setlocal
title Hyperliquid Grid Bot - API
cd /d "%~dp0"

echo =======================================
echo  Hyperliquid Grid Bot - API starting...
echo  Dashboard: http://127.0.0.1:3000/dashboard
echo =======================================
echo.

REM Optional: open the dashboard in default browser
start "" "http://127.0.0.1:3000/dashboard"

REM Run the API
npm run api

echo.
echo API stopped. Press any key to close.
pause >nul
endlocal
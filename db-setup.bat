@echo off
setlocal
title Hyperliquid Grid Bot - Setup DB
cd /d "%~dp0"

echo =======================================
echo  Hyperliquid Grid Bot - DB setup...
echo  Running: npm install
echo  Then:   npm run db:setup
echo =======================================
echo.

REM Install dependencies
npm install
if errorlevel 1 goto :error

echo.
REM Create schema + seed
npm run db:setup
if errorlevel 1 goto :error

echo.
echo =======================================
echo  Setup finished!
echo  Next: run start-api.bat
echo =======================================
echo.
pause >nul
endlocal
exit /b 0

:error
echo.
echo =======================================
echo  Setup failed. Check the errors above.
echo =======================================
echo.
pause >nul
endlocal
exit /b 1
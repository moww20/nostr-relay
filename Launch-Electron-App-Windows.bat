@echo off
setlocal ENABLEEXTENSIONS
cd /d "%~dp0"

echo.
echo Nostr Indexer - Electron Launcher
echo -------------------------------

where npm >nul 2>&1
if errorlevel 1 (
  echo Error: npm not found in PATH. Please install Node.js from https://nodejs.org/
  pause
  exit /b 1
)

echo Launching Electron app...
call npm run electron
set ERR=%ERRORLEVEL%

if not "%ERR%"=="0" (
  echo.
  echo Electron app exited with code %ERR%.
  pause
)

endlocal
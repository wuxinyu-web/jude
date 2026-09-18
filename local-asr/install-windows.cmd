@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python Launcher was not found. Install 64-bit Python 3.12 from python.org first.
  pause
  exit /b 1
)
set /p JUDE_EXTENSION_ID=Paste the extension ID from chrome://extensions:
py -3.12 install.py --extension-id "%JUDE_EXTENSION_ID%"
if errorlevel 1 (
  echo Installation failed. Keep this window open and send the error message to support.
) else (
  echo Installation completed. You can now double-click start-windows.cmd.
)
pause

@echo off
setlocal
cd /d "%~dp0"
py -3.12 start.py
if errorlevel 1 pause

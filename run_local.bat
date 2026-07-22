@echo off
chcp 65001 >nul
setlocal

REM run_local.bat — Lance calculate_pi.py en arrière-plan sous Windows
REM Usage : run_local.bat
REM         run_local.bat -Digits 50000
REM         run_local.bat -Reset

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "run_local.ps1" %*

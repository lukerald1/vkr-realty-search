@echo off
setlocal
cd /d "%~dp0"
if not defined PROSTOR_HTTPS_PROXY set "PROSTOR_HTTPS_PROXY=http://127.0.0.1:7890"
set "HTTPS_PROXY=%PROSTOR_HTTPS_PROXY%"
set "NO_PROXY=localhost,127.0.0.1,::1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-local-llm.ps1"
pause
endlocal

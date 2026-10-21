@echo off
cd /d "%~dp0"
set "PROSTOR_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "PROSTOR_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  ) else (
    echo Please install Node.js 22 or newer, then run this file again.
    pause
    exit /b 1
  )
)
"%PROSTOR_NODE%" --env-file-if-exists=.env apps/server.mjs
pause

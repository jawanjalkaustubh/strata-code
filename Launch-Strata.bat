@echo off
title Strata Code - Dual-Model Hybrid & Offline AI Studio
cd /d "%~dp0"

echo ===============================================================
echo  STRATA CODE - DUAL-MODEL HYBRID & OFFLINE AI STUDIO
echo  Accelerated by NVIDIA GeForce RTX 5090 (32GB VRAM)
echo ===============================================================

:: 1. Auto-launch Ollama background daemon if not already responding
curl.exe -s http://127.0.0.1:11434/api/tags >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [*] Starting local Ollama background service...
    where ollama >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        start "" /b ollama serve >nul 2>&1
    ) else if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" (
        start "" /b "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve >nul 2>&1
    )
    timeout /t 2 /nobreak >nul 2>&1
)

:: 1b. The Qwen3-Coder llama-server on port 8080 is started by the app itself a few
::     seconds after its window has loaded (electron/main.ts), guarded so it never
::     starts beside a loading server or an Ollama model still holding VRAM.
::     Starting it here too raced that guard and doubled the load (2026-09-10).

:: 2. Auto-launch Live Stream Watcher Daemon in background if Python is available
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    if exist "%~dp0watch-strata-live.py" (
        start "" /b python -u "%~dp0watch-strata-live.py" >nul 2>&1
    )
)

:: 3. This launcher now lives inside the strata folder itself (moved 2026-09-11).

:: 4. Verify build artifacts exist; build once if missing
if not exist "dist-electron\main.js" (
    echo [*] Initial build required. Building Strata Code frontend and electron...
    call npm run build
)

:: 5. Launch Strata Code desktop application
echo [*] Launching Strata Code desktop application...
if exist "node_modules\electron\dist\electron.exe" (
    start "" "node_modules\electron\dist\electron.exe" .
) else (
    call npm start
)

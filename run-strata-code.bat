@echo off
title Strata Code - Local AI Studio
cd /d "%~dp0"

:: Launch the app FIRST so the window is on screen before any model load
:: starts. Loading the 26 GB coder model saturates the disk, PCIe and GPU
:: for ~40 seconds; starting it before Electron made the app appear hung.
if exist "node_modules\electron\dist\electron.exe" (
    start "" "node_modules\electron\dist\electron.exe" .
) else (
    start "" cmd /c npm start
)

:: Auto-launch Ollama background daemon if not already responding (cheap; it loads no model)
curl.exe -s http://127.0.0.1:11434/api/tags >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    where ollama >nul 2>&1
    if %ERRORLEVEL% EQU 0 (
        start "" /b ollama serve >nul 2>&1
    ) else if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" (
        start "" /b "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve >nul 2>&1
    )
)

:: The Qwen3-Coder llama-server on port 8080 is started by the app itself,
:: a few seconds after its window has finished loading (electron/main.ts).
:: Starting it here as well raced that and doubled the load.

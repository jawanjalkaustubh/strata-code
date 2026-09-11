@echo off
title Stop Llama Server - Port 8080
taskkill /F /IM llama-server.exe >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] llama-server stopped. VRAM freed on RTX 5090.
) else (
    echo [Info] llama-server was not running.
)
timeout /t 3

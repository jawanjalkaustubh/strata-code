@echo off
title Stop Strata Coder - Port 8080
rem Only the coder on port 8080. Ollama runs its own llama-server.exe processes
rem (Strata Photo / Video models) on random ports; "taskkill /IM llama-server.exe"
rem used to evict those too.
set "found="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'llama-server.exe' -and $_.CommandLine -match '--port 8080' } | ForEach-Object { $_.ProcessId }"`) do (
    taskkill /F /PID %%P >nul 2>&1
    set "found=1"
)
if defined found (
    echo [OK] Strata coder on port 8080 stopped. VRAM freed.
) else (
    echo [Info] No coder server on port 8080 was running. Ollama models were left alone.
)
timeout /t 3

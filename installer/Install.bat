@echo off
title Strata Code - Installer
cd /d "%~dp0"
echo.
echo  Strata Code installer. This window shows progress; downloads are large (~45 GB total).
echo  If it is interrupted, run it again - downloads resume.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1" %*
echo.
if %ERRORLEVEL% NEQ 0 (
    echo  Install did not complete. See install.log in this folder.
) else (
    echo  Done.
)
pause

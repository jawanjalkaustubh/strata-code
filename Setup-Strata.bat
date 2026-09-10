@echo off
title Strata Code - Setup & Environment Initializer
cd /d "%~dp0"

echo =======================================================
echo          STRATA CODE - SETUP & LAUNCHER
echo      Autonomous 100%% Local AI Coding Studio
echo           Author: Kaustubh Jawanjal
echo =======================================================
echo Initializing setup wizard...

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-Strata.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Setup encountered an issue. Press any key to exit.
    pause >nul
)

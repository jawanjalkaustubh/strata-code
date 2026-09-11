@echo off
title Strata Code - Automated Backup
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Backup-Strata.ps1"
pause
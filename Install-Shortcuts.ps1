<#
=============================================================================
 STRATA CODE - DESKTOP & START MENU SHORTCUT CREATOR
 Lives inside the strata folder; TargetDir defaults to this folder.
=============================================================================
#>
param(
    [string]$TargetDir = $PSScriptRoot
)

if (-not $TargetDir) { $TargetDir = "D:\AntiGravity\strata" }

$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$StartMenuPath = [Environment]::GetFolderPath("Programs")

$VbsLauncher = Join-Path $TargetDir "run-strata-code.vbs"
if (-not (Test-Path $VbsLauncher)) {
    $VbsLauncher = Join-Path $TargetDir "Launch-Strata.vbs"
}
$IconPath = Join-Path $TargetDir "assets\strata-code-sc.ico"
if (-not (Test-Path $IconPath)) {
    $IconPath = Join-Path $TargetDir "assets\icon.ico"
}

# 1. Desktop Shortcut
$DesktopShortcut = $WshShell.CreateShortcut((Join-Path $DesktopPath "Strata Code.lnk"))
$DesktopShortcut.TargetPath = "wscript.exe"
$DesktopShortcut.Arguments = "`"$VbsLauncher`""
$DesktopShortcut.WorkingDirectory = $TargetDir
$DesktopShortcut.Description = "Strata Code - Autonomous Local AI Coding Studio"
if (Test-Path $IconPath) {
    $DesktopShortcut.IconLocation = "$IconPath,0"
}
$DesktopShortcut.Save()
Write-Host "Created Desktop shortcut: Strata Code.lnk" -ForegroundColor Green

# 2. Start Menu Shortcut
$StartMenuDir = Join-Path $StartMenuPath "Strata Code"
if (-not (Test-Path $StartMenuDir)) {
    New-Item -ItemType Directory -Path $StartMenuDir -Force | Out-Null
}
$StartMenuShortcut = $WshShell.CreateShortcut((Join-Path $StartMenuDir "Strata Code.lnk"))
$StartMenuShortcut.TargetPath = "wscript.exe"
$StartMenuShortcut.Arguments = "`"$VbsLauncher`""
$StartMenuShortcut.WorkingDirectory = $TargetDir
$StartMenuShortcut.Description = "Strata Code - Autonomous Local AI Coding Studio"
if (Test-Path $IconPath) {
    $StartMenuShortcut.IconLocation = "$IconPath,0"
}
$StartMenuShortcut.Save()
Write-Host "Created Start Menu shortcut: Strata Code.lnk" -ForegroundColor Green

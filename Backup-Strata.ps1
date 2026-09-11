<#
=============================================================================
 STRATA CODE - AUTOMATED BACKUP SCRIPT
 Author: Kaustubh Jawanjal
 Synchronizes Strata Code to secondary project mirrors and updates the
 distribution archive.
=============================================================================
#>

$ErrorActionPreference = "Stop"

$SourceDir = "D:\AntiGravity\strata"
$MirrorDir2 = "C:\AI_dev\projects\strata"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " STRATA CODE - AUTOMATED BACKUP & MIRROR" -ForegroundColor Cyan
Write-Host " Source: $SourceDir" -ForegroundColor Cyan
Write-Host " Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# Ensure source exists
if (-not (Test-Path $SourceDir)) {
    throw "Source directory not found: $SourceDir"
}

# Directories and files to synchronize
$FoldersToSync = @("src", "electron", "dist", "dist-electron", "assets", "public")
$FilesToSync = @(
    "index.html", "package.json", "package-lock.json", "tsconfig.json", 
    "vite.config.ts", "tailwind.config.js", "postcss.config.js", 
    "generate_icon.py", "run-strata-code.bat", "run-strata-code.vbs",
    "Setup-Strata.bat", "Setup-Strata.ps1", "README.md",
    "PROJECT_OVERVIEW.md", "ARCHITECTURE.md",
    "Launch-Strata.bat", "Launch-Strata.vbs", "Backup-Strata.bat", "Backup-Strata.ps1",
    "Create-Distribution-Zip.ps1", "Install-Shortcuts.ps1", "Stop-Server-8080.bat",
    "DEPENDENCIES-AND-SETUP-GUIDE.md", "GEMINI.md", "query-local-worker.ps1", "watch-strata-live.py"
)

$Targets = @($MirrorDir2)

foreach ($target in $Targets) {
    Write-Host "`nBacking up to: $target..." -ForegroundColor Green
    if (-not (Test-Path $target)) {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
    }

    # Sync Folders
    foreach ($folder in $FoldersToSync) {
        $srcFolder = Join-Path $SourceDir $folder
        $dstFolder = Join-Path $target $folder
        if (Test-Path $srcFolder) {
            Write-Host "  Copying folder $folder..." -ForegroundColor Gray
            if (Test-Path $dstFolder) {
                Remove-Item -Path $dstFolder -Recurse -Force -ErrorAction SilentlyContinue
            }
            Copy-Item -Path $srcFolder -Destination $dstFolder -Recurse -Force
        }
    }

    # Sync Individual Files
    foreach ($file in $FilesToSync) {
        $srcFile = Join-Path $SourceDir $file
        $dstFile = Join-Path $target $file
        if (Test-Path $srcFile) {
            Copy-Item -Path $srcFile -Destination $dstFile -Force
        }
    }

}

# Re-generate the Distribution Zip Archive
Write-Host "`nRe-packing distribution package..." -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File "D:\AntiGravity\strata\Create-Distribution-Zip.ps1"

# Copy zip to C:\AI_dev\projects\strata
if (Test-Path "D:\AntiGravity\strata\release\Strata-Code-Windows-x64.zip") {
    Write-Host "`nCopying distribution archive to C:\AI_dev\projects\strata..." -ForegroundColor Green
    Copy-Item -Path "D:\AntiGravity\strata\release\Strata-Code-Windows-x64.zip" -Destination "C:\AI_dev\projects\strata\Strata-Code-Windows-x64.zip" -Force
}

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " BACKUP COMPLETE & SYNCHRONIZED!" -ForegroundColor Cyan
Write-Host " Primary:       D:\AntiGravity\strata" -ForegroundColor Green
Write-Host " Mirror:        C:\AI_dev\projects\strata" -ForegroundColor Green
Write-Host " Archive:       D:\AntiGravity\strata\release\Strata-Code-Windows-x64.zip" -ForegroundColor Green
Write-Host " Mirror Archive: C:\AI_dev\projects\strata\Strata-Code-Windows-x64.zip" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan
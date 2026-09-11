<#
=============================================================================
 STRATA CODE - DISTRIBUTION ZIP PACKAGER
 Packs Strata Code and Setup-Strata launcher into a single distributable zip.
 Author: Kaustubh Jawanjal
=============================================================================
#>

param(
    [string]$OutputDir = "D:\AntiGravity\strata\release",
    [string]$ZipName = "Strata-Code-Windows-x64.zip"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " STRATA CODE - DISTRIBUTION ZIP PACKAGER" -ForegroundColor Cyan
Write-Host " Author: Kaustubh Jawanjal" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# Source paths
$StrataDir = "D:\AntiGravity\strata"
$SetupBat = "D:\AntiGravity\strata\Setup-Strata.bat"
$SetupPs1 = "D:\AntiGravity\strata\Setup-Strata.ps1"

if (-not (Test-Path $StrataDir)) {
    throw "Strata directory not found at $StrataDir"
}

if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null }
$ZipPath = Join-Path $OutputDir $ZipName
$StagingDir = Join-Path $env:TEMP "StrataZipStaging"

if (Test-Path $StagingDir) {
    Write-Host "Cleaning existing staging directory..." -ForegroundColor Yellow
    Remove-Item -Path $StagingDir -Recurse -Force
}

New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null
$PackageDir = Join-Path $StagingDir "Strata-Code-Windows-x64"
New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null

Write-Host "Copying launcher scripts..." -ForegroundColor Green
Copy-Item -Path $SetupBat -Destination $PackageDir -Force
Copy-Item -Path $SetupPs1 -Destination $PackageDir -Force
if (Test-Path (Join-Path $StrataDir "Launch-Strata.bat")) {
    Copy-Item -Path (Join-Path $StrataDir "Launch-Strata.bat") -Destination $PackageDir -Force
}
if (Test-Path (Join-Path $StrataDir "Launch-Strata.vbs")) {
    Copy-Item -Path (Join-Path $StrataDir "Launch-Strata.vbs") -Destination $PackageDir -Force
}
if (Test-Path (Join-Path $StrataDir "query-local-worker.ps1")) {
    Copy-Item -Path (Join-Path $StrataDir "query-local-worker.ps1") -Destination $PackageDir -Force
}
if (Test-Path (Join-Path $StrataDir "GEMINI.md")) {
    Copy-Item -Path (Join-Path $StrataDir "GEMINI.md") -Destination $PackageDir -Force
}
if (Test-Path (Join-Path $StrataDir "Backup-Strata.bat")) {
    Copy-Item -Path (Join-Path $StrataDir "Backup-Strata.bat") -Destination $PackageDir -Force
}
if (Test-Path (Join-Path $StrataDir "Backup-Strata.ps1")) {
    Copy-Item -Path (Join-Path $StrataDir "Backup-Strata.ps1") -Destination $PackageDir -Force
}
if (Test-Path (Join-Path $StrataDir "DEPENDENCIES-AND-SETUP-GUIDE.md")) {
    Copy-Item -Path (Join-Path $StrataDir "DEPENDENCIES-AND-SETUP-GUIDE.md") -Destination $PackageDir -Force
}
if (Test-Path (Join-Path $StrataDir "watch-strata-live.py")) {
    Copy-Item -Path (Join-Path $StrataDir "watch-strata-live.py") -Destination $PackageDir -Force
}
if (Test-Path (Join-Path $StrataDir "installer")) {
    Copy-Item -Path (Join-Path $StrataDir "installer") -Destination (Join-Path $PackageDir "installer") -Recurse -Force
}

# Create README.txt in package
$ReadmeContent = @"
======================================================================
 STRATA CODE - DUAL-MODEL HYBRID & 100% LOCAL AI CODING STUDIO
======================================================================
 Author: Kaustubh Jawanjal
 Hardware: NVIDIA RTX 5090 (32GB VRAM) / Any CUDA GPU

 MODES SUPPORTED:
 1. [100% Sovereign Local Mode]:
    - Fully offline, zero internet, $0 cost, unlimited local tokens.
    - Powered by local Ollama (qwen3.8:27b / qwen2.5-coder).
 2. [Dual-Model Hybrid Collaboration Mode]:
    - Google Antigravity Cloud Architect + Local RTX 5090 Worker.
    - Preserves ~95% to 100% of cloud quota.

 QUICK START INSTRUCTIONS:
 1. Double-click "Setup-Strata.bat"
 2. Review and accept the Liability Disclaimer
 3. Choose your desired installation folder (or keep default)
 4. Click "Install & Setup Strata Code"
 5. Launch with "Launch-Strata.bat" or "Launch-Strata.vbs" (silent)

 See "DEPENDENCIES-AND-SETUP-GUIDE.md" for full documentation!
======================================================================
"@
Set-Content -Path (Join-Path $PackageDir "README.txt") -Value $ReadmeContent -Encoding UTF8

# Copy strata directory
$DestStrataDir = Join-Path $PackageDir "strata"
Write-Host "Staging Strata Code application files (excluding git and logs)..." -ForegroundColor Green

# Use robocopy for fast, clean copying with exclusions
$excludeDirs = @(".git", ".vscode")
$excludeFiles = @("*.log", "out.log", "err.log", "electron.log")

& robocopy $StrataDir $DestStrataDir /E /XD .git .vscode release backup-2026-09-10 backup-2026-09-10-algorithm agent-leftovers-2026-09-10 /XF *.log out.log err.log electron.log *.zip strata-live-session.md /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null

# Copy launchers into strata folder as well for self-contained portability
Copy-Item -Path $SetupBat -Destination $DestStrataDir -Force
Copy-Item -Path $SetupPs1 -Destination $DestStrataDir -Force

Write-Host "Files staged successfully." -ForegroundColor Green

# If zip already exists, remove it
if (Test-Path $ZipPath) {
    Write-Host "Removing previous zip at $ZipPath..." -ForegroundColor Yellow
    Remove-Item -Path $ZipPath -Force
}

# Compress
Write-Host "Compressing distribution zip to $ZipPath (this may take 1-2 minutes)..." -ForegroundColor Cyan
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($PackageDir, $ZipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

# Clean up staging
Write-Host "Cleaning staging files..." -ForegroundColor Gray
Remove-Item -Path $StagingDir -Recurse -Force -ErrorAction SilentlyContinue

$zipItem = Get-Item $ZipPath
$zipSizeMB = [math]::Round($zipItem.Length / 1MB, 2)

Write-Host "========================================================" -ForegroundColor Green
Write-Host "🎉 DISTRIBUTION ZIP READY!" -ForegroundColor Green
Write-Host "Path: $ZipPath" -ForegroundColor Green
Write-Host "Size: $zipSizeMB MB" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green

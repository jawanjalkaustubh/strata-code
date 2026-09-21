<#
=============================================================================
 STRATA CODE - INSTALLER
 Sets up everything the app needs on a fresh Windows machine:
   1. checks the GPU, driver, RAM and free disk
   2. installs Ollama (winget, or the official installer) and starts it
   3. pulls the general model (qwen3.8:27b, ~18 GB) into Ollama
   4. downloads the coder model GGUF (~19-25 GB) into .\models
   5. writes runtime\coder-config.json (model + context size for your VRAM)
   6. creates Desktop / Start Menu shortcuts and launches Strata Code

 Downloads resume if interrupted - just run Install.bat again.

 Options (run from PowerShell):
   .\Install.ps1 -Coder Q4_K_M        force the smaller coder model
   .\Install.ps1 -SkipModels          only Ollama + shortcuts
   .\Install.ps1 -SkipOllama          only the coder model + shortcuts
   .\Install.ps1 -NoLaunch            do not start the app at the end
   .\Install.ps1 -DryRun              check everything, download nothing
=============================================================================
#>
param(
    [ValidateSet("auto", "Q6_K", "Q4_K_M")] [string]$Coder = "auto",
    [switch]$SkipModels,
    [switch]$SkipOllama,
    [switch]$NoShortcuts,
    [switch]$NoLaunch,
    [switch]$DryRun,
    # Records acceptance of EULA.md without the interactive prompt (you must have read it).
    [switch]$AcceptAgreement
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$ModelsDir = Join-Path $Root "models"
$RuntimeDir = Join-Path $Root "runtime"
$AppExe    = Join-Path $Root "Strata Code.exe"
$LogFile   = Join-Path $Root "install.log"

$GeneralModel = "qwen3.8:27b"
$CoderRepo    = "https://huggingface.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF/resolve/main"
$CoderFiles = @{
    "Q6_K"   = @{ Name = "Qwen3-Coder-30B-A3B-Instruct-Q6_K.gguf";   Bytes = 25092535456; MinVramGB = 28; Ctx = 65536 }
    "Q4_K_M" = @{ Name = "Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf"; Bytes = 18556689568; MinVramGB = 22; Ctx = 32768 }
}

function Log([string]$msg, [string]$color = "Gray") {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
    Write-Host $line -ForegroundColor $color
    try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch {}
}
function Step([string]$msg) { Write-Host ""; Log "=== $msg ===" "Cyan" }
function Fail([string]$msg) { Log "ERROR: $msg" "Red"; Write-Host ""; Write-Host "Install did not complete. See install.log. You can re-run Install.bat; downloads resume." -ForegroundColor Yellow; exit 1 }

Write-Host ""
Write-Host "  STRATA CODE - LOCAL AI CODING STUDIO - INSTALLER" -ForegroundColor Cyan
Write-Host "  Install folder: $Root" -ForegroundColor DarkGray
if ($DryRun) { Write-Host "  DRY RUN: nothing will be downloaded or changed." -ForegroundColor Yellow }
Write-Host ""

# ---------------------------------------------------------------------------
Step "0/6 License Agreement"
# ---------------------------------------------------------------------------
# The app modifies files and runs commands; nothing is installed or run until
# the agreement is accepted. Acceptance is recorded (keyed to a hash of the
# text) where the app looks for it, so the app does not ask again.
$EulaPath = Join-Path $Root "EULA.md"
if (-not (Test-Path $EulaPath)) { Fail "EULA.md is missing next to this script. The zip is incomplete." }
$eulaText = [IO.File]::ReadAllText($EulaPath, [Text.Encoding]::UTF8)
$eulaNorm = $eulaText -replace "`r", ""
$sha = [Security.Cryptography.SHA256]::Create()
$eulaVersion = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($eulaNorm))) -replace "-", "").ToLower().Substring(0, 16)
$AppData = Join-Path $env:APPDATA "StrataCode-v1"
$acceptFile = Join-Path $AppData "agreement.json"
$alreadyAccepted = $false
try { if (Test-Path $acceptFile) { $rec = Get-Content $acceptFile -Raw | ConvertFrom-Json; $alreadyAccepted = ($rec.version -eq $eulaVersion) } } catch {}

if ($alreadyAccepted) {
    Log "Agreement version $eulaVersion already accepted on this machine." "Green"
} elseif ($DryRun) {
    Log "Would show EULA.md (version $eulaVersion) and require 'I AGREE'." "Yellow"
} else {
    if (-not $AcceptAgreement) {
        Write-Host ""
        Write-Host $eulaText
        Write-Host ""
        Write-Host "  You must accept the License Agreement above to continue." -ForegroundColor Yellow
        Write-Host "  It is also saved as EULA.md in this folder." -ForegroundColor DarkGray
        $answer = Read-Host "  Type I AGREE to accept, or anything else to cancel"
        if ($answer.Trim().ToUpper() -ne "I AGREE") {
            Log "Agreement not accepted. Nothing was installed." "Yellow"
            exit 2
        }
    }
    $record = @{
        version    = $eulaVersion
        acceptedAt = (Get-Date).ToUniversalTime().ToString("o")
        acceptedIn = $(if ($AcceptAgreement) { "installer (-AcceptAgreement)" } else { "installer (typed I AGREE)" })
        user       = $env:USERNAME
        machine    = $env:COMPUTERNAME
    } | ConvertTo-Json
    New-Item -ItemType Directory -Path $AppData -Force | Out-Null
    [IO.File]::WriteAllText($acceptFile, $record, (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $Root "agreement-accepted.json"), $record, (New-Object Text.UTF8Encoding($false)))
    Log "Agreement version $eulaVersion accepted. Recorded in $acceptFile" "Green"
}

# ---------------------------------------------------------------------------
Step "1/6 System check"
# ---------------------------------------------------------------------------
if (-not [Environment]::Is64BitOperatingSystem) { Fail "64-bit Windows is required." }
if (-not (Test-Path $AppExe)) { Fail "Strata Code.exe not found next to this script. Extract the whole zip first." }
if (-not (Test-Path (Join-Path $RuntimeDir "llama.cpp\llama-server.exe"))) { Fail "runtime\llama.cpp\llama-server.exe is missing. The zip is incomplete." }

$gpuName = $null; $vramGB = 0; $driver = $null
try {
    $smi = & nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits 2>$null
    if ($smi) {
        $parts = ($smi | Select-Object -First 1).ToString().Split(",")
        $gpuName = $parts[0].Trim(); $vramGB = [math]::Round([double]$parts[1].Trim() / 1024, 1); $driver = $parts[2].Trim()
    }
} catch {}
if (-not $gpuName) {
    Fail "No NVIDIA GPU detected (nvidia-smi not found). Strata Code's coder server needs an NVIDIA GPU with a CUDA 12 capable driver."
}
Log "GPU: $gpuName  |  VRAM: $vramGB GB  |  Driver: $driver" "Green"
$driverMajor = 0; try { $driverMajor = [int]($driver.Split(".")[0]) } catch {}
if ($driverMajor -lt 528) { Log "Driver $driver is old. CUDA 12 needs 528+. Update at https://www.nvidia.com/drivers if the coder server fails to start." "Yellow" }
if ($vramGB -lt 20) { Log "Only $vramGB GB VRAM. The coder model needs ~22 GB (Q4_K_M) or ~28 GB (Q6_K). It will not fit; you can still use the general model via Ollama." "Yellow" }

$ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 0)
Log "System RAM: $ramGB GB" $(if ($ramGB -ge 32) { "Green" } else { "Yellow" })
if ($ramGB -lt 24) { Log "Less than 24 GB RAM: model loading will be slow and the machine may stall while a model loads." "Yellow" }

$drive = (Get-Item $Root).PSDrive
$freeGB = [math]::Round($drive.Free / 1GB, 0)
Log "Free disk on $($drive.Name): $freeGB GB (need ~30 GB here for the coder model; Ollama models go to your user profile drive, ~20 GB)" $(if ($freeGB -ge 30) { "Green" } else { "Yellow" })

# Coder choice
$coderKey = $Coder
if ($coderKey -eq "auto") { $coderKey = if ($vramGB -ge 28) { "Q6_K" } elseif ($vramGB -ge 22) { "Q4_K_M" } else { "Q4_K_M" } }
$coderInfo = $CoderFiles[$coderKey]
$ctx = $coderInfo.Ctx
if ($vramGB -ge 30 -and $coderKey -eq "Q6_K") { $ctx = 65536 } elseif ($coderKey -eq "Q6_K") { $ctx = 32768 }
if ($coderKey -eq "Q4_K_M" -and $vramGB -lt 24) { $ctx = 16384 }
Log "Coder model: $coderKey ($([math]::Round($coderInfo.Bytes / 1GB, 1)) GB), context $ctx tokens" "Green"

# ---------------------------------------------------------------------------
Step "2/6 Ollama"
# ---------------------------------------------------------------------------
function Find-Ollama {
    foreach ($p in @("$env:LOCALAPPDATA\Programs\Ollama\ollama.exe", "C:\Program Files\Ollama\ollama.exe")) { if (Test-Path $p) { return $p } }
    $cmd = Get-Command ollama -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}
$ollama = Find-Ollama
if ($SkipOllama) {
    Log "Skipping Ollama (-SkipOllama)." "Yellow"
} elseif ($ollama) {
    Log "Ollama found: $ollama" "Green"
} elseif ($DryRun) {
    Log "Ollama not installed; would install it now." "Yellow"
} else {
    $installed = $false
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Log "Installing Ollama with winget..."
        try {
            & winget install --id Ollama.Ollama -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
            $installed = $true
        } catch { Log "winget install failed: $($_.Exception.Message)" "Yellow" }
    }
    if (-not $installed) {
        $setup = Join-Path $env:TEMP "OllamaSetup.exe"
        Log "Downloading the official Ollama installer (~1.5 GB)..."
        & curl.exe -L --fail --retry 5 --retry-delay 5 -C - -o $setup "https://ollama.com/download/OllamaSetup.exe"
        if ($LASTEXITCODE -ne 0) { Fail "Could not download OllamaSetup.exe. Install Ollama from https://ollama.com and re-run." }
        Log "Running the Ollama installer silently..."
        $p = Start-Process -FilePath $setup -ArgumentList "/silent" -PassThru -Wait
        if ($p.ExitCode -ne 0) { Log "Ollama installer exit code $($p.ExitCode)" "Yellow" }
    }
    Start-Sleep -Seconds 3
    $ollama = Find-Ollama
    if (-not $ollama) { Fail "Ollama still not found after install. Install it from https://ollama.com and re-run." }
    Log "Ollama installed: $ollama" "Green"
}

function Test-OllamaApi { try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 3; return $r.StatusCode -eq 200 } catch { return $false } }
if (-not $SkipOllama -and -not $DryRun) {
    if (-not (Test-OllamaApi)) {
        Log "Starting the Ollama service..."
        Start-Process -FilePath $ollama -ArgumentList "serve" -WindowStyle Hidden
        $ok = $false
        for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Seconds 1; if (Test-OllamaApi) { $ok = $true; break } }
        if (-not $ok) { Fail "Ollama did not answer on http://127.0.0.1:11434 within 20 s." }
    }
    Log "Ollama API is online." "Green"
}

# ---------------------------------------------------------------------------
Step "3/6 General model ($GeneralModel via Ollama)"
# ---------------------------------------------------------------------------
if ($SkipModels -or $SkipOllama) {
    Log "Skipped." "Yellow"
} elseif ($DryRun) {
    Log "Would run: ollama pull $GeneralModel (~18 GB)" "Yellow"
} else {
    $have = $false
    try { $tags = (Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json; $have = @($tags.models | Where-Object { $_.name -eq $GeneralModel }).Count -gt 0 } catch {}
    if ($have) {
        Log "$GeneralModel is already installed." "Green"
    } else {
        Log "Pulling $GeneralModel (~18 GB). This is the long part; progress shows below."
        & $ollama pull $GeneralModel
        if ($LASTEXITCODE -ne 0) { Fail "ollama pull $GeneralModel failed. Check your connection and re-run." }
        Log "$GeneralModel installed." "Green"
    }
}

# ---------------------------------------------------------------------------
Step "4/6 Coder model ($coderKey GGUF into .\models)"
# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Path $ModelsDir -Force | Out-Null
$ggufPath = Join-Path $ModelsDir $coderInfo.Name
$url = "$CoderRepo/$($coderInfo.Name)"
if ($SkipModels) {
    Log "Skipped." "Yellow"
} elseif ((Test-Path $ggufPath) -and ((Get-Item $ggufPath).Length -eq $coderInfo.Bytes)) {
    Log "$($coderInfo.Name) already present and complete." "Green"
} elseif ($DryRun) {
    try { $h = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 5; Log "Would download $url ($([math]::Round($coderInfo.Bytes/1GB,1)) GB) - reachable (HTTP $($h.StatusCode))." "Yellow" } catch { Log "Would download $url - NOT reachable: $($_.Exception.Message)" "Red" }
} else {
    if (Test-Path $ggufPath) { Log "Partial file found ($([math]::Round((Get-Item $ggufPath).Length/1GB,1)) GB) - resuming." }
    Log "Downloading $($coderInfo.Name) ($([math]::Round($coderInfo.Bytes/1GB,1)) GB) from Hugging Face..."
    $attempt = 0; $done = $false
    while (-not $done -and $attempt -lt 6) {
        $attempt++
        & curl.exe -L --fail --retry 3 --retry-delay 10 -C - --progress-bar -o $ggufPath $url
        if ((Test-Path $ggufPath) -and ((Get-Item $ggufPath).Length -eq $coderInfo.Bytes)) { $done = $true }
        elseif ($attempt -lt 6) { Log "Download interrupted (attempt $attempt). Retrying in 10 s..." "Yellow"; Start-Sleep -Seconds 10 }
    }
    if (-not $done) { Fail "Coder model download did not complete. Re-run Install.bat to resume." }
    Log "Coder model downloaded and size-verified." "Green"
}

# ---------------------------------------------------------------------------
Step "5/6 Runtime configuration"
# ---------------------------------------------------------------------------
$cfg = @{ model = $coderInfo.Name; ctx = $ctx; vramGB = $vramGB; gpu = $gpuName; writtenBy = "Install.ps1"; writtenAt = (Get-Date).ToString("s") } | ConvertTo-Json
if ($DryRun) { Log "Would write runtime\coder-config.json: $cfg" "Yellow" }
else { Set-Content -Path (Join-Path $RuntimeDir "coder-config.json") -Value $cfg -Encoding UTF8; Log "runtime\coder-config.json written (model=$($coderInfo.Name), ctx=$ctx)." "Green" }

# Unblock files extracted from a downloaded zip (Windows "mark of the web").
if (-not $DryRun) { try { Get-ChildItem -Path $Root -Recurse -File | Unblock-File -ErrorAction SilentlyContinue } catch {} }

# ---------------------------------------------------------------------------
Step "6/6 Shortcuts"
# ---------------------------------------------------------------------------
if ($NoShortcuts) { Log "Skipped (-NoShortcuts)." "Yellow" }
elseif ($DryRun) { Log "Would create Desktop and Start Menu shortcuts to Strata Code.exe" "Yellow" }
else {
    try {
        $wsh = New-Object -ComObject WScript.Shell
        $icon = Join-Path $Root "resources\app\assets\strata.ico"
        if (-not (Test-Path $icon)) { $icon = $AppExe }
        foreach ($lnk in @((Join-Path ([Environment]::GetFolderPath("Desktop")) "Strata Code.lnk"),
                           (Join-Path (Join-Path ([Environment]::GetFolderPath("Programs")) "Strata Code") "Strata Code.lnk"))) {
            $dir = Split-Path -Parent $lnk
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            $s = $wsh.CreateShortcut($lnk)
            $s.TargetPath = $AppExe
            $s.WorkingDirectory = $Root
            $s.Description = "Strata Code - Local AI Coding Studio"
            $s.IconLocation = "$icon,0"
            $s.Save()
            Log "Shortcut: $lnk" "Green"
        }
    } catch { Log "Could not create shortcuts: $($_.Exception.Message)" "Yellow" }
}

Write-Host ""
Log "Install complete." "Green"
Log "Launch: Strata Code.exe (or the Desktop shortcut). The coder server starts on its own ~10-60 s after the window appears." "Green"
Log "Logs: %APPDATA%\StrataCode-v1\coder-server.log  |  install.log next to this script." "DarkGray"
if (-not $NoLaunch -and -not $DryRun) {
    Log "Starting Strata Code..."
    Start-Process -FilePath $AppExe -WorkingDirectory $Root
}

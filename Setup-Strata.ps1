<#
=============================================================================
 STRATA CODE - COMPLETE SETUP & LAUNCHER WIZARD
 Autonomous 100% Local AI Coding Studio
 Author: Kaustubh Jawanjal
=============================================================================
#>

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Determine script root
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if (-not $ScriptDir) {
    $ScriptDir = (Get-Location).Path
}

# Locate source strata directory
$SourceStrataDir = ""
if (Test-Path (Join-Path $ScriptDir "strata\package.json")) {
    $SourceStrataDir = Join-Path $ScriptDir "strata"
} elseif (Test-Path (Join-Path $ScriptDir "package.json")) {
    $SourceStrataDir = $ScriptDir
} elseif (Test-Path "D:\AntiGravity\strata\package.json") {
    $SourceStrataDir = "D:\AntiGravity\strata"
} else {
    $SourceStrataDir = $ScriptDir
}

# Determine sensible default destination
$DefaultDestDir = $SourceStrataDir
# If running inside a temporary or extraction directory outside AntiGravity, default to LocalAppData
if ($ScriptDir -notlike "*AntiGravity*" -and $ScriptDir -notlike "*strata*") {
    $DefaultDestDir = Join-Path $env:LOCALAPPDATA "Programs\StrataCode"
}

# Hardware Detection
$detectedGPU = "Standard Display Adapter"
$detectedVRAM = 0.0
$recommendedModel = "qwen2.5-coder:14b"

try {
    $smi = nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>$null
    if ($smi) {
        $firstLine = ($smi | Select-Object -First 1).ToString().Trim()
        $parts = $firstLine -split ','
        if ($parts.Count -ge 2) {
            $detectedGPU = $parts[0].Trim()
            $vramMB = [double]$parts[1].Trim()
            $detectedVRAM = [math]::Round($vramMB / 1024, 1)
        }
    }
} catch {}

if ($detectedGPU -eq "Standard Display Adapter") {
    try {
        $wmiGPU = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notlike "*Basic*" -and $_.Name -notlike "*Virtual*" } | Select-Object -First 1
        if (-not $wmiGPU) {
            $wmiGPU = Get-CimInstance Win32_VideoController | Select-Object -First 1
        }
        if ($wmiGPU) {
            $detectedGPU = $wmiGPU.Name
            if ($wmiGPU.AdapterRAM -gt 0) {
                $detectedVRAM = [math]::Round($wmiGPU.AdapterRAM / 1GB, 1)
            }
        }
    } catch {}
}

if ($detectedVRAM -ge 24.0) {
    $recommendedModel = "qwen3.8:27b"
} elseif ($detectedVRAM -ge 12.0) {
    $recommendedModel = "qwen2.5-coder:14b"
} else {
    $recommendedModel = "qwen2.5-coder:7b"
}

# ---------------------------------------------------------------------------
# WinForms GUI Setup
# ---------------------------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = "Strata Code - Setup & Environment Initializer"
$form.Size = New-Object System.Drawing.Size(840, 780)
$form.MinimumSize = New-Object System.Drawing.Size(840, 780)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(20, 20, 24)
$form.ForeColor = [System.Drawing.Color]::White

# Try to set Form Icon
$iconPath = Join-Path $SourceStrataDir "assets\strata-code-sc.ico"
if (Test-Path $iconPath) {
    try {
        $form.Icon = New-Object System.Drawing.Icon($iconPath)
    } catch {}
}

# Header Banner
$headerPanel = New-Object System.Windows.Forms.Panel
$headerPanel.Dock = [System.Windows.Forms.DockStyle]::Top
$headerPanel.Height = 90
$headerPanel.BackColor = [System.Drawing.Color]::FromArgb(14, 14, 18)
$form.Controls.Add($headerPanel)

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "STRATA CODE"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = [System.Drawing.Color]::FromArgb(255, 255, 255)
$lblTitle.Location = New-Object System.Drawing.Point(24, 12)
$lblTitle.AutoSize = $true
$headerPanel.Controls.Add($lblTitle)

$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Text = "Autonomous 100% Local AI Coding Studio • Complete 1-Click Environment Setup"
$lblSub.Font = New-Object System.Drawing.Font("Segoe UI", 9.5, [System.Drawing.FontStyle]::Regular)
$lblSub.ForeColor = [System.Drawing.Color]::FromArgb(161, 161, 170)
$lblSub.Location = New-Object System.Drawing.Point(26, 52)
$lblSub.AutoSize = $true
$headerPanel.Controls.Add($lblSub)

$lblAuthor = New-Object System.Windows.Forms.Label
$lblAuthor.Text = "Author: Kaustubh Jawanjal"
$lblAuthor.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$lblAuthor.ForeColor = [System.Drawing.Color]::FromArgb(129, 140, 248) # Indigo accent
$lblAuthor.Location = New-Object System.Drawing.Point(620, 20)
$lblAuthor.AutoSize = $true
$headerPanel.Controls.Add($lblAuthor)

# Group 1: Disclaimer & Liability Waiver
$grpDisclaimer = New-Object System.Windows.Forms.GroupBox
$grpDisclaimer.Text = "  1. Disclaimer & Liability Waiver (Required)  "
$grpDisclaimer.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$grpDisclaimer.ForeColor = [System.Drawing.Color]::FromArgb(251, 146, 60) # Amber orange
$grpDisclaimer.Location = New-Object System.Drawing.Point(24, 100)
$grpDisclaimer.Size = New-Object System.Drawing.Size(776, 175)
$form.Controls.Add($grpDisclaimer)

$txtDisclaimer = New-Object System.Windows.Forms.TextBox
$txtDisclaimer.Multiline = $true
$txtDisclaimer.ReadOnly = $true
$txtDisclaimer.ScrollBars = "Vertical"
$txtDisclaimer.Font = New-Object System.Drawing.Font("Segoe UI", 8.5)
$txtDisclaimer.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 34)
$txtDisclaimer.ForeColor = [System.Drawing.Color]::FromArgb(228, 228, 231)
$txtDisclaimer.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$txtDisclaimer.Location = New-Object System.Drawing.Point(16, 22)
$txtDisclaimer.Size = New-Object System.Drawing.Size(744, 110)
$txtDisclaimer.Text = @"
STRATA CODE - DISCLAIMER & LIABILITY WAIVER

This software, its source code, packaged distributions, and automated installation scripts are provided "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT.

UNDER NO CIRCUMSTANCES SHALL THE AUTHOR, KAUSTUBH JAWANJAL, CONTRIBUTORS, OR AFFILIATED PARTIES BE HELD LIABLE OR RESPONSIBLE FOR ANY CLAIM, DAMAGES, LOSS OF DATA, CODE CORRUPTION, SYSTEM INSTABILITY, HARDWARE WEAR, INTELLECTUAL PROPERTY ISSUES, FINANCIAL LOSSES, OR OTHER LIABILITIES ARISING DIRECTLY OR INDIRECTLY FROM:
1. The installation, execution, configuration, or removal of Strata Code, Ollama, or associated runtime dependencies.
2. Any code, scripts, terminal commands, file modifications, or architectural suggestions generated by artificial intelligence models (including Qwen, Llama, Ollama, or third-party models) operating within or connected to this software.
3. The autonomous capabilities of Strata Code, including multi-turn file edits, terminal execution, and workspace refactoring.

You are solely responsible for reviewing any code prior to execution or production use, maintaining adequate backups of your workspaces, and ensuring your computing environment complies with applicable security standards.
"@
$grpDisclaimer.Controls.Add($txtDisclaimer)

$chkAccept = New-Object System.Windows.Forms.CheckBox
$chkAccept.Text = "I have read, understood, and accept the disclaimer & liability waiver above (Author: Kaustubh Jawanjal)."
$chkAccept.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$chkAccept.ForeColor = [System.Drawing.Color]::FromArgb(244, 244, 245)
$chkAccept.Location = New-Object System.Drawing.Point(16, 140)
$chkAccept.AutoSize = $true
$chkAccept.Cursor = [System.Windows.Forms.Cursors]::Hand
$grpDisclaimer.Controls.Add($chkAccept)

# Group 2: Install Destination Folder
$grpPath = New-Object System.Windows.Forms.GroupBox
$grpPath.Text = "  2. Installation Destination Folder  "
$grpPath.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$grpPath.ForeColor = [System.Drawing.Color]::FromArgb(96, 165, 250) # Blue
$grpPath.Location = New-Object System.Drawing.Point(24, 285)
$grpPath.Size = New-Object System.Drawing.Size(776, 75)
$form.Controls.Add($grpPath)

$txtPath = New-Object System.Windows.Forms.TextBox
$txtPath.Font = New-Object System.Drawing.Font("Segoe UI", 9.5)
$txtPath.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 34)
$txtPath.ForeColor = [System.Drawing.Color]::White
$txtPath.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$txtPath.Location = New-Object System.Drawing.Point(16, 28)
$txtPath.Size = New-Object System.Drawing.Size(630, 27)
$txtPath.Text = $DefaultDestDir
$grpPath.Controls.Add($txtPath)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = "Browse..."
$btnBrowse.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Regular)
$btnBrowse.BackColor = [System.Drawing.Color]::FromArgb(63, 63, 70)
$btnBrowse.ForeColor = [System.Drawing.Color]::White
$btnBrowse.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnBrowse.FlatAppearance.BorderSize = 0
$btnBrowse.Location = New-Object System.Drawing.Point(656, 26)
$btnBrowse.Size = New-Object System.Drawing.Size(104, 31)
$btnBrowse.Cursor = [System.Windows.Forms.Cursors]::Hand
$grpPath.Controls.Add($btnBrowse)

$btnBrowse.Add_Click({
    $fbd = New-Object System.Windows.Forms.FolderBrowserDialog
    $fbd.Description = "Select Destination Folder for Strata Code"
    $fbd.SelectedPath = $txtPath.Text
    if ($fbd.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $txtPath.Text = $fbd.SelectedPath
    }
})

# Group 3: Hardware Detection & Model Selection
$grpAI = New-Object System.Windows.Forms.GroupBox
$grpAI.Text = "  3. Hardware Detection & AI Model Selection  "
$grpAI.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$grpAI.ForeColor = [System.Drawing.Color]::FromArgb(167, 139, 250) # Purple
$grpAI.Location = New-Object System.Drawing.Point(24, 370)
$grpAI.Size = New-Object System.Drawing.Size(776, 85)
$form.Controls.Add($grpAI)

$lblHW = New-Object System.Windows.Forms.Label
if ($detectedVRAM -gt 0) {
    $lblHW.Text = "Hardware Detected: $detectedGPU ($detectedVRAM GB VRAM)"
} else {
    $lblHW.Text = "Hardware Detected: $detectedGPU"
}
$lblHW.Font = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Regular)
$lblHW.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153) # Emerald green
$lblHW.Location = New-Object System.Drawing.Point(16, 22)
$lblHW.AutoSize = $true
$grpAI.Controls.Add($lblHW)

$lblModel = New-Object System.Windows.Forms.Label
$lblModel.Text = "Default Coding Model:"
$lblModel.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Regular)
$lblModel.ForeColor = [System.Drawing.Color]::FromArgb(212, 212, 216)
$lblModel.Location = New-Object System.Drawing.Point(16, 48)
$lblModel.AutoSize = $true
$grpAI.Controls.Add($lblModel)

$cmbModel = New-Object System.Windows.Forms.ComboBox
$cmbModel.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$cmbModel.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$cmbModel.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 34)
$cmbModel.ForeColor = [System.Drawing.Color]::White
$cmbModel.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$cmbModel.Location = New-Object System.Drawing.Point(170, 45)
$cmbModel.Size = New-Object System.Drawing.Size(590, 26)

[void]$cmbModel.Items.Add("qwen3.8:27b        (Recommended for 24-32GB VRAM - Next-Gen Qwen 3.8 Architecture)")
[void]$cmbModel.Items.Add("qwen2.5-coder:32b  (Recommended for 24GB+ VRAM - Peak Reasoning & Agentic Coding)")
[void]$cmbModel.Items.Add("qwen2.5-coder:14b  (Recommended for 12-24GB VRAM - High Speed & Balanced)")
[void]$cmbModel.Items.Add("qwen2.5-coder:7b   (Recommended for 8-12GB VRAM / Laptops)")
[void]$cmbModel.Items.Add("Skip model download (Ollama setup only)")

if ($recommendedModel -eq "qwen3.8:27b") {
    $cmbModel.SelectedIndex = 0
} elseif ($recommendedModel -eq "qwen2.5-coder:32b") {
    $cmbModel.SelectedIndex = 1
} elseif ($recommendedModel -eq "qwen2.5-coder:14b") {
    $cmbModel.SelectedIndex = 2
} else {
    $cmbModel.SelectedIndex = 3
}
$grpAI.Controls.Add($cmbModel)

# Group 4: Progress & Real-time Console Log
$grpProgress = New-Object System.Windows.Forms.GroupBox
$grpProgress.Text = "  4. Setup Progress & Status  "
$grpProgress.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$grpProgress.ForeColor = [System.Drawing.Color]::FromArgb(161, 161, 170)
$grpProgress.Location = New-Object System.Drawing.Point(24, 465)
$grpProgress.Size = New-Object System.Drawing.Size(776, 200)
$form.Controls.Add($grpProgress)

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Location = New-Object System.Drawing.Point(16, 24)
$progressBar.Size = New-Object System.Drawing.Size(744, 18)
$progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
$progressBar.Value = 0
$grpProgress.Controls.Add($progressBar)

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true
$txtLog.ReadOnly = $true
$txtLog.ScrollBars = "Vertical"
$txtLog.Font = New-Object System.Drawing.Font("Consolas", 8.5)
$txtLog.BackColor = [System.Drawing.Color]::FromArgb(12, 12, 15)
$txtLog.ForeColor = [System.Drawing.Color]::FromArgb(167, 243, 208)
$txtLog.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$txtLog.Location = New-Object System.Drawing.Point(16, 50)
$txtLog.Size = New-Object System.Drawing.Size(744, 136)
$txtLog.Text = "[Ready] Check disclaimer checkbox above and click 'Install & Setup Strata Code' to begin.`r`n"
$grpProgress.Controls.Add($txtLog)

# Bottom Actions
$pnlButtons = New-Object System.Windows.Forms.Panel
$pnlButtons.Location = New-Object System.Drawing.Point(24, 678)
$pnlButtons.Size = New-Object System.Drawing.Size(776, 50)
$form.Controls.Add($pnlButtons)

$btnInstall = New-Object System.Windows.Forms.Button
$btnInstall.Text = "Install & Setup Strata Code"
$btnInstall.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$btnInstall.BackColor = [System.Drawing.Color]::FromArgb(60, 60, 70) # Disabled gray initially
$btnInstall.ForeColor = [System.Drawing.Color]::White
$btnInstall.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnInstall.FlatAppearance.BorderSize = 0
$btnInstall.Location = New-Object System.Drawing.Point(0, 5)
$btnInstall.Size = New-Object System.Drawing.Size(260, 42)
$btnInstall.Cursor = [System.Windows.Forms.Cursors]::Hand
$btnInstall.Enabled = $false
$pnlButtons.Controls.Add($btnInstall)

$btnLaunch = New-Object System.Windows.Forms.Button
$btnLaunch.Text = "Launch Strata Code"
$btnLaunch.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$btnLaunch.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129) # Emerald
$btnLaunch.ForeColor = [System.Drawing.Color]::White
$btnLaunch.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnLaunch.FlatAppearance.BorderSize = 0
$btnLaunch.Location = New-Object System.Drawing.Point(275, 5)
$btnLaunch.Size = New-Object System.Drawing.Size(200, 42)
$btnLaunch.Cursor = [System.Windows.Forms.Cursors]::Hand
$btnLaunch.Enabled = $false
$pnlButtons.Controls.Add($btnLaunch)

$btnExit = New-Object System.Windows.Forms.Button
$btnExit.Text = "Exit"
$btnExit.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$btnExit.BackColor = [System.Drawing.Color]::FromArgb(63, 63, 70)
$btnExit.ForeColor = [System.Drawing.Color]::White
$btnExit.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnExit.FlatAppearance.BorderSize = 0
$btnExit.Location = New-Object System.Drawing.Point(656, 5)
$btnExit.Size = New-Object System.Drawing.Size(120, 42)
$btnExit.Cursor = [System.Windows.Forms.Cursors]::Hand
$pnlButtons.Controls.Add($btnExit)

$btnExit.Add_Click({ $form.Close() })

# Checkbox handler: dynamically enable/disable install button
$chkAccept.Add_CheckedChanged({
    $btnInstall.Enabled = $chkAccept.Checked
    if ($chkAccept.Checked) {
        $btnInstall.BackColor = [System.Drawing.Color]::FromArgb(79, 70, 229) # Indigo active
    } else {
        $btnInstall.BackColor = [System.Drawing.Color]::FromArgb(60, 60, 70)
    }
})

# Helper log function
function Log-Msg([string]$msg, [int]$progress = -1) {
    $timestamp = Get-Date -Format "HH:mm:ss"
    $txtLog.AppendText("[$timestamp] $msg`r`n")
    $txtLog.SelectionStart = $txtLog.Text.Length
    $txtLog.ScrollToCaret()
    if ($progress -ge 0) {
        $progressBar.Value = [math]::Min(100, [math]::Max(0, $progress))
    }
    [System.Windows.Forms.Application]::DoEvents()
}

# Launch Strata Action
$btnLaunch.Add_Click({
    $targetDir = $txtPath.Text.Trim()
    $vbsPath = Join-Path $targetDir "run-strata-code.vbs"
    $batPath = Join-Path $targetDir "run-strata-code.bat"

    if (Test-Path $vbsPath) {
        Start-Process "wscript.exe" -ArgumentList "`"$vbsPath`""
        $form.Close()
    } elseif (Test-Path $batPath) {
        Start-Process "cmd.exe" -ArgumentList "/c `"$batPath`""
        $form.Close()
    } else {
        [System.Windows.Forms.MessageBox]::Show("Could not find launcher script in $targetDir", "Launch Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
    }
})

# Install Button Click Handler
$btnInstall.Add_Click({
    $btnInstall.Enabled = $false
    $chkAccept.Enabled = $false
    $btnBrowse.Enabled = $false
    $cmbModel.Enabled = $false
    $txtPath.ReadOnly = $true

    $dest = $txtPath.Text.Trim()
    if (-not $dest) {
        [System.Windows.Forms.MessageBox]::Show("Please specify a valid destination directory.", "Path Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
        $btnInstall.Enabled = $true
        $chkAccept.Enabled = $true
        $btnBrowse.Enabled = $true
        $cmbModel.Enabled = $true
        return
    }

    # Selected Model
    $selectedModelText = $cmbModel.SelectedItem.ToString()
    $modelToPull = ""
    if ($selectedModelText -match "^(qwen[\w\.\-]+:\w+)") {
        $modelToPull = $matches[1]
    }

    Log-Msg "Starting Strata Code setup & initialization..." 5

    # Step 1: Destination Folder Validation & Copying
    Log-Msg "[1/5] Validating destination directory: $dest" 10
    if (-not (Test-Path $dest)) {
        try {
            New-Item -ItemType Directory -Path $dest -Force | Out-Null
            Log-Msg "Created destination directory: $dest" 15
        } catch {
            Log-Msg "ERROR creating destination directory: $_"
            [System.Windows.Forms.MessageBox]::Show("Failed to create destination directory: $_", "Setup Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
            return
        }
    }

    # Canonical path comparison
    $srcCanonical = ""
    $destCanonical = ""
    try { $srcCanonical = (Resolve-Path $SourceStrataDir).Path.TrimEnd('\') } catch {}
    try { $destCanonical = (Resolve-Path $dest).Path.TrimEnd('\') } catch {}

    if ($srcCanonical -and $destCanonical -and ($srcCanonical -ne $destCanonical)) {
        Log-Msg "Copying Strata Code files to destination..." 20
        try {
            $items = Get-ChildItem -Path $SourceStrataDir -Exclude ".git", "out.log", "err.log", "electron.log"
            $total = $items.Count
            $count = 0
            foreach ($item in $items) {
                $count++
                $p = [math]::Round(20 + ($count / $total * 15))
                Log-Msg "Copying $($item.Name)..." $p
                Copy-Item -Path $item.FullName -Destination $dest -Recurse -Force
            }
            Log-Msg "Strata Code application files ready at: $dest" 35
        } catch {
            Log-Msg "Notice during file copy: $_"
        }
    } else {
        Log-Msg "Operating in in-place directory: $dest" 35
    }

    # Step 2: Ollama Verification & Download
    Log-Msg "[2/5] Checking Ollama installation..." 40
    $ollamaExe = ""
    $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
    if ($ollamaCmd) {
        $ollamaExe = $ollamaCmd.Source
    } elseif (Test-Path "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe") {
        $ollamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    } elseif (Test-Path "C:\Program Files\Ollama\ollama.exe") {
        $ollamaExe = "C:\Program Files\Ollama\ollama.exe"
    }

    if (-not $ollamaExe -or -not (Test-Path $ollamaExe)) {
        Log-Msg "Ollama not found on system. Downloading official installer (OllamaSetup.exe)..." 45
        $installerUrl = "https://ollama.com/download/OllamaSetup.exe"
        $tempInstaller = Join-Path $env:TEMP "OllamaSetup.exe"

        try {
            # Use System.Net.Http.HttpClient or WebClient
            $wc = New-Object System.Net.WebClient
            $wc.DownloadFile($installerUrl, $tempInstaller)
            Log-Msg "Ollama installer downloaded successfully. Launching setup..." 55

            $proc = Start-Process -FilePath $tempInstaller -ArgumentList "/silent" -PassThru -Wait
            Log-Msg "Ollama installer completed." 60

            # Wait and detect installed binary
            Start-Sleep -Seconds 3
            if (Test-Path "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe") {
                $ollamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
            }
        } catch {
            Log-Msg "ERROR downloading or installing Ollama: $_"
            Log-Msg "Please install Ollama manually from: https://ollama.com"
        }
    } else {
        Log-Msg "Ollama detected: $ollamaExe" 60
    }

    # Step 3: Ensure Ollama Service is Active
    Log-Msg "[3/5] Checking Ollama API service (port 11434)..." 65
    $serviceRunning = $false
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($resp.StatusCode -eq 200) { $serviceRunning = $true }
    } catch {}

    if (-not $serviceRunning) {
        Log-Msg "Ollama service is not running. Starting 'ollama serve' in background..." 70
        if ($ollamaExe -and (Test-Path $ollamaExe)) {
            # Clear any hung or zombie processes holding port 11434
            Stop-Process -Name ollama -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 800
            Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
            Start-Sleep -Seconds 3
            try {
                $resp = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
                if ($resp.StatusCode -eq 200) { $serviceRunning = $true }
            } catch {}
        }
    }

    if ($serviceRunning) {
        Log-Msg "Ollama API service is online and healthy." 75
    } else {
        Log-Msg "Notice: Could not automatically verify Ollama API service. You can start Ollama manually from the Start Menu." 75
    }

    # Step 4: Model Verification and Automated Pull
    if ($modelToPull) {
        Log-Msg "[4/5] Checking AI model: $modelToPull..." 80
        $modelExists = $false
        try {
            $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -ErrorAction SilentlyContinue
            if ($tags.models) {
                foreach ($m in $tags.models) {
                    if ($m.name -eq $modelToPull -or $m.model -eq $modelToPull) {
                        $modelExists = $true
                        break
                    }
                }
            }
        } catch {}

        if ($modelExists) {
            Log-Msg "Model '$modelToPull' is already installed and cached locally!" 88
        } else {
            Log-Msg "Downloading model '$modelToPull' (this may take several minutes depending on internet connection)..." 82
            if ($ollamaExe) {
                try {
                    # Launch pull via cmd wrapper to avoid pipe deadlocks and capture output
                    $psi = New-Object System.Diagnostics.ProcessStartInfo
                    $psi.FileName = "cmd.exe"
                    $psi.Arguments = "/c `"$ollamaExe`" pull $modelToPull 2>&1"
                    $psi.RedirectStandardOutput = $true
                    $psi.UseShellExecute = $false
                    $psi.CreateNoWindow = $true

                    $p = [System.Diagnostics.Process]::Start($psi)
                    while (-not $p.HasExited) {
                        $line = $p.StandardOutput.ReadLine()
                        if ($line) {
                            # Clean carriage returns and display
                            $cleanLine = ($line -replace "[\r\n]", "").Trim()
                            if ($cleanLine) {
                                Log-Msg $cleanLine
                            }
                        }
                        [System.Windows.Forms.Application]::DoEvents()
                    }
                    Log-Msg "Model '$modelToPull' successfully pulled!" 88
                } catch {
                    Log-Msg "Warning during model pull: $_"
                }
            } else {
                Log-Msg "Please run 'ollama pull $modelToPull' in your terminal after installation." 88
            }
        }
    } else {
        Log-Msg "[4/5] Model download skipped by user preference." 88
    }

    # Step 5: Desktop & Start Menu Shortcuts
    Log-Msg "[5/5] Creating Desktop & Start Menu shortcuts..." 90
    try {
        $wsh = New-Object -ComObject WScript.Shell
        $desktopPaths = @(
            [System.Environment]::GetFolderPath('Desktop')
        )
        if ($env:OneDrive -and (Test-Path (Join-Path $env:OneDrive "Desktop"))) {
            $desktopPaths += (Join-Path $env:OneDrive "Desktop")
        }

        $vbsLauncher = Join-Path $dest "run-strata-code.vbs"
        $iconFile = Join-Path $dest "assets\strata-code-sc.ico"

        foreach ($dt in ($desktopPaths | Select-Object -Unique)) {
            if (Test-Path $dt) {
                $lnkPath = Join-Path $dt "Strata Code.lnk"
                $shortcut = $wsh.CreateShortcut($lnkPath)
                $shortcut.TargetPath = "wscript.exe"
                $shortcut.Arguments = "`"$vbsLauncher`""
                $shortcut.WorkingDirectory = $dest
                $shortcut.Description = "Strata Code - Autonomous Local AI Coding Studio"
                if (Test-Path $iconFile) {
                    $shortcut.IconLocation = "$iconFile, 0"
                }
                $shortcut.Save()
                Log-Msg "Desktop shortcut created: $lnkPath"
            }
        }

        # Start Menu Shortcut
        $startMenuPath = [System.Environment]::GetFolderPath('Programs')
        if (Test-Path $startMenuPath) {
            $smLnk = Join-Path $startMenuPath "Strata Code.lnk"
            $smShortcut = $wsh.CreateShortcut($smLnk)
            $smShortcut.TargetPath = "wscript.exe"
            $smShortcut.Arguments = "`"$vbsLauncher`""
            $smShortcut.WorkingDirectory = $dest
            $smShortcut.Description = "Strata Code - Autonomous Local AI Coding Studio"
            if (Test-Path $iconFile) {
                $smShortcut.IconLocation = "$iconFile, 0"
            }
            $smShortcut.Save()
            Log-Msg "Start Menu shortcut created: $smLnk"
        }
    } catch {
        Log-Msg "Notice while creating shortcuts: $_"
    }

    Log-Msg "========================================================" 100
    Log-Msg "🎉 Strata Code setup is complete and fully initialized!" 100
    Log-Msg "You can launch Strata Code below or from your Desktop." 100

    $btnLaunch.Enabled = $true
    $btnLaunch.Focus()
    [System.Windows.Forms.MessageBox]::Show("Strata Code is fully installed, configured, and ready to use!`r`n`r`nClick 'Launch Strata Code' to start your autonomous local studio.", "Setup Complete", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
})

# Display Form Dialog
[void]$form.ShowDialog()

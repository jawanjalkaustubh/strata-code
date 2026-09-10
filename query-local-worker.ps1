<#
=============================================================================
 STRATA / ANTIGRAVITY - LOCAL WORKER INFERENCE BRIDGE
 Connects Google Antigravity (Cloud Architect) directly to the local
 NVIDIA RTX 5090 Worker (qwen3.8:27b) via Ollama API.
=============================================================================
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$Prompt,

    [string]$SystemPrompt = "You are the Local Sovereign Worker running on the user's NVIDIA RTX 5090. You partner with Google Antigravity (Cloud Architect) to implement code, run edits, and solve engineering challenges. Address your response to the Google Antigravity Architect.",

    [string]$Model = "qwen3.8:27b"
)

$ErrorActionPreference = "Stop"

# Ensure Ollama daemon is responsive
$ollamaOnline = $false
try {
    $check = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
    if ($check.StatusCode -eq 200) { $ollamaOnline = $true }
} catch {}

if (-not $ollamaOnline) {
    # Auto-wake Ollama daemon
    where.exe ollama >$null 2>&1
    if ($LASTEXITCODE -eq 0) {
        Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 3
    }
}

# Verify model availability, fallback to installed qwen if needed
try {
    $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -ErrorAction SilentlyContinue
    $installed = $tags.models | ForEach-Object { $_.name }
    if ($installed -notcontains $Model) {
        $qwenModel = $installed | Where-Object { $_ -like "*qwen*" } | Select-Object -First 1
        if ($qwenModel) { $Model = $qwenModel }
    }
} catch {}

$messages = @()
if ($SystemPrompt) {
    $messages += @{ role = "system"; content = $SystemPrompt }
}
$messages += @{ role = "user"; content = $Prompt }

$body = @{
    model = $Model
    messages = $messages
    stream = $false
    options = @{
        temperature = 0.2
        num_ctx = 16384
    }
} | ConvertTo-Json -Depth 5

try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/chat" -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 120
    if ($response.message -and $response.message.content) {
        Write-Output $response.message.content
    } else {
        Write-Output "(No output generated from local model)"
    }
} catch {
    Write-Error "Local worker query failed: $_"
}
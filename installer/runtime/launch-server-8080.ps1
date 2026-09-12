<#
=============================================================================
 STRATA CODE - CODER SERVER LAUNCHER (PORT 8080)
 Runs the bundled llama.cpp server on the Qwen3-Coder GGUF.

 Normally started by Strata Code itself (electron/main.ts), which passes the
 model path and context size chosen by the installer. Can also be run by hand:
   .\launch-server-8080.ps1                       # first GGUF in ..\..\models
   .\launch-server-8080.ps1 -Ctx 32768            # smaller KV cache
   .\launch-server-8080.ps1 -Model D:\x\y.gguf

 Tuning (kept from the reference workstation, RTX 5090):
  --jinja           native tool-call template on /v1/chat/completions
  -c <Ctx>          Q8 KV cache costs ~51 KB/token on this model
  -b / -ub          large prefill batches; prompt processing is the bottleneck
  --cache-reuse     salvage KV after the middle of the prompt changes
  sampling          Qwen3-Coder model-card defaults
=============================================================================
#>
param(
    [string]$Model = "",
    [int]$Ctx = 65536,
    [int]$GpuLayers = 99,
    [int]$Batch = 4096,
    [int]$UBatch = 1024,
    [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ModelsDir = Join-Path (Split-Path -Parent (Split-Path -Parent $ScriptDir)) "models"

if (-not $Model) {
    $found = Get-ChildItem (Join-Path $ModelsDir "*.gguf") -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 1
    if ($found) { $Model = $found.FullName }
}

if (-not $Model -or -not (Test-Path $Model)) {
    Write-Host "[Error] No GGUF model found. Expected one in: $ModelsDir" -ForegroundColor Red
    Write-Host "        Run Install.bat to download the coder model." -ForegroundColor Yellow
    exit 1
}

$server = Join-Path $ScriptDir "llama-server.exe"
if (-not (Test-Path $server)) {
    Write-Host "[Error] llama-server.exe not found next to this script: $ScriptDir" -ForegroundColor Red
    exit 1
}

# Refuse to start if the port is already bound - avoids two servers fighting over VRAM.
$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    $pids = ($existing | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
    Write-Host "[Error] Port $Port is already in use (PID: $pids). Stop that server first." -ForegroundColor Red
    exit 1
}

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " STRATA CODE - CODER SERVER (PORT $Port)" -ForegroundColor Cyan
Write-Host " Model:   $Model" -ForegroundColor Green
Write-Host " Context: $Ctx tokens (Flash Attention + Q8 KV cache)" -ForegroundColor Green
Write-Host " Batch:   -b $Batch / -ub $UBatch  |  KV prefix reuse: on" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan

& $server `
  -m $Model `
  --port $Port `
  --host 127.0.0.1 `
  -ngl $GpuLayers `
  -c $Ctx `
  -b $Batch `
  -ub $UBatch `
  --cache-type-k q8_0 `
  --cache-type-v q8_0 `
  --flash-attn on `
  --cache-reuse 256 `
  --jinja `
  --metrics `
  --temp 0.7 `
  --top-p 0.8 `
  --top-k 20 `
  --repeat-penalty 1.05 `
  --alias "Qwen3-Coder-30B-A3B-Instruct"

exit $LASTEXITCODE

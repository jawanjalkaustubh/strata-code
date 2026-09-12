<#
=============================================================================
 STRATA CODE - RELEASE PACKAGER
 Produces release\Strata-Code-Windows-x64.zip containing:
   Strata Code.exe + Electron runtime      (@electron/packager, no node_modules)
   runtime\llama.cpp\                      llama-server.exe + required DLLs + launch script
   models\                                 empty; the installer fills it
   Install.bat / Install.ps1 / README.md   installer
   LICENSES\
 Usage (from the strata folder):  powershell -ExecutionPolicy Bypass -File installer\package.ps1
   -SkipBuild     reuse dist/ and dist-electron/
   -NoZip         stop after assembling release\Strata-Code-Windows-x64\
=============================================================================
#>
param(
    [switch]$SkipBuild,
    [switch]$NoZip,
    [string]$LlamaDir = "C:\AI_dev\llama.cpp"
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
$Release = Join-Path $Root "release"
$PkgName = "Strata-Code-Windows-x64"
$Stage   = Join-Path $Release $PkgName
$Zip     = Join-Path $Release "$PkgName.zip"
$version = (Get-Content (Join-Path $Root "package.json") | ConvertFrom-Json).version

function Step($m) { Write-Host ""; Write-Host "=== $m ===" -ForegroundColor Cyan }

Step "0. Preconditions"
if (-not (Test-Path (Join-Path $LlamaDir "llama-server.exe"))) { throw "llama-server.exe not found in $LlamaDir" }
# llama-server prints its version on stderr; PowerShell 5.1 turns native stderr
# into a terminating error under "Stop", so route it through cmd.
$serverVer = (& cmd.exe /c "`"$(Join-Path $LlamaDir 'llama-server.exe')`" --version 2>&1" | Select-Object -First 1)
Write-Host "llama.cpp: $serverVer"
Write-Host "app version: $version"

if (-not $SkipBuild) {
    Step "1. npm run build"
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
}

Step "2. Electron packager"
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Path $Release -Force | Out-Null
$pkgOut = Join-Path $Release "pkg"
if (Test-Path $pkgOut) { Remove-Item -Recurse -Force $pkgOut }
# Ship only what the main process needs: package.json, dist/, dist-electron/, assets/.
# node_modules is excluded wholesale (main.js is fully bundled by Vite).
$ignore = @(
    '^/node_modules', '^/src', '^/electron', '^/installer', '^/release', '^/backup-', '^/agent-leftovers-',
    '^/\.git', '^/\.claude', '^/public', '^/index\.html$', '^/(?!EULA\.md$)[^/]+\.md$', '^/[^/]+\.ps1$', '^/[^/]+\.bat$', '^/[^/]+\.vbs$',
    '^/[^/]+\.py$', '^/tsconfig\.json$', '^/vite\.config\.ts$', '^/tailwind\.config\.js$', '^/postcss\.config\.js$',
    '^/package-lock\.json$', '^/\.gitignore$', '^/strata-live-session\.md$', '^/[^/]+\.log$'
)
$ignoreArgs = $ignore | ForEach-Object { "--ignore=$_" }
& npx @electron/packager . "Strata Code" --platform=win32 --arch=x64 --out=$pkgOut --overwrite `
    --icon=assets/strata.ico --app-version=$version --win32metadata.CompanyName="Kaustubh Jawanjal" `
    --win32metadata.ProductName="Strata Code" --win32metadata.FileDescription="Strata Code - Local Dual-Brain AI Coding Studio" `
    --prune=true --asar=false @ignoreArgs
if ($LASTEXITCODE -ne 0) { throw "electron packager failed" }
$packed = Get-ChildItem $pkgOut -Directory | Select-Object -First 1
if (-not $packed) { throw "packager produced no output" }
Move-Item $packed.FullName $Stage
Remove-Item -Recurse -Force $pkgOut
Write-Host "app packaged: $Stage"

Step "3. llama.cpp runtime"
$rt = Join-Path $Stage "runtime\llama.cpp"
New-Item -ItemType Directory -Path $rt -Force | Out-Null
$needed = @('llama-server.exe', 'llama-server-impl.dll', 'llama-common.dll', 'llama.dll', 'mtmd.dll',
            'ggml.dll', 'ggml-base.dll', 'ggml-cuda.dll', 'ggml-rpc.dll', 'libomp.dll',
            'cudart64_12.dll', 'cublas64_12.dll', 'cublasLt64_12.dll')
$needed += (Get-ChildItem $LlamaDir -Filter 'ggml-cpu-*.dll' | Select-Object -ExpandProperty Name)
foreach ($f in $needed) {
    $src = Join-Path $LlamaDir $f
    if (-not (Test-Path $src)) { throw "runtime file missing: $src" }
    Copy-Item $src (Join-Path $rt $f) -Force
}
Copy-Item (Join-Path $Root "installer\runtime\launch-server-8080.ps1") (Join-Path $rt "launch-server-8080.ps1") -Force
Set-Content -Path (Join-Path $rt "VERSION.txt") -Value "$serverVer`nCUDA 12 build (cublas64_12 / cudart64_12)`nPackaged $(Get-Date -Format s)" -Encoding UTF8
$rtSize = [math]::Round(((Get-ChildItem $rt -File | Measure-Object Length -Sum).Sum) / 1MB, 0)
Write-Host "runtime: $($needed.Count) files, $rtSize MB"

Step "4. Installer, models dir, docs, licenses"
New-Item -ItemType Directory -Path (Join-Path $Stage "models") -Force | Out-Null
Set-Content -Path (Join-Path $Stage "models\README.txt") -Value "The coder model (Qwen3-Coder-30B-A3B-Instruct GGUF) is downloaded here by Install.bat.`nYou can also copy any .gguf into this folder yourself; the largest one is used." -Encoding UTF8
Copy-Item (Join-Path $Root "installer\Install.ps1") (Join-Path $Stage "Install.ps1") -Force
Copy-Item (Join-Path $Root "installer\Install.bat") (Join-Path $Stage "Install.bat") -Force
Copy-Item (Join-Path $Root "installer\README.md") (Join-Path $Stage "README.md") -Force
Copy-Item (Join-Path $Root "EULA.md") (Join-Path $Stage "EULA.md") -Force
$lic = Join-Path $Stage "LICENSES"
New-Item -ItemType Directory -Path $lic -Force | Out-Null
Copy-Item (Join-Path $Root "installer\LICENSES\*") $lic -Force
Copy-Item (Join-Path $Stage "LICENSE") (Join-Path $lic "Electron-LICENSE.txt") -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $Stage "LICENSES.chromium.html") (Join-Path $lic "Chromium-LICENSES.html") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Stage "LICENSE"), (Join-Path $Stage "LICENSES.chromium.html"), (Join-Path $Stage "version") -Force -ErrorAction SilentlyContinue
Set-Content -Path (Join-Path $Stage "VERSION.txt") -Value "Strata Code $version`nBuilt $(Get-Date -Format s)`nCommit $(git rev-parse --short HEAD 2>$null)" -Encoding UTF8

Step "5. Sanity"
foreach ($must in @("Strata Code.exe", "resources\app\package.json", "resources\app\EULA.md", "resources\app\dist\index.html", "resources\app\dist-electron\main.js", "resources\app\dist-electron\preload.cjs", "runtime\llama.cpp\llama-server.exe", "runtime\llama.cpp\launch-server-8080.ps1", "Install.bat", "Install.ps1", "README.md", "EULA.md")) {
    if (-not (Test-Path (Join-Path $Stage $must))) { throw "missing from package: $must" }
}
if (Test-Path (Join-Path $Stage "resources\app\node_modules")) { throw "node_modules leaked into the package" }
$total = [math]::Round(((Get-ChildItem $Stage -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 0)
Write-Host "package folder: $total MB, $((Get-ChildItem $Stage -Recurse -File).Count) files"

if ($NoZip) { Write-Host "Stopped before zip (-NoZip). Folder: $Stage"; exit 0 }

Step "6. Zip"
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Push-Location $Release
try {
    # Windows' own bsdtar produces a standard zip that Explorer opens, far faster
    # than Compress-Archive on 1 GB. Explicit path: Git for Windows puts a GNU tar
    # on PATH that reads "D:" as a remote host.
    $bsdtar = Join-Path $env:SystemRoot "System32\tar.exe"
    & $bsdtar -a -cf $Zip $PkgName
    if ($LASTEXITCODE -ne 0) { throw "tar failed" }
} finally { Pop-Location }
$zipMB = [math]::Round((Get-Item $Zip).Length / 1MB, 0)
$sha = (Get-FileHash $Zip -Algorithm SHA256).Hash
Set-Content -Path "$Zip.sha256" -Value "$sha  $PkgName.zip" -Encoding ASCII
Write-Host ""
Write-Host "RELEASE: $Zip" -ForegroundColor Green
Write-Host "size:    $zipMB MB $(if ($zipMB -gt 2000) { '(!! over the 2 GB GitHub release asset limit)' } else { '(under the 2 GB GitHub limit)' })" -ForegroundColor $(if ($zipMB -gt 2000) { 'Red' } else { 'Green' })
Write-Host "sha256:  $sha"

# Prepares keystore helper + optional Windows sidecars for Tauri packaging.
# Usage:
#   .\scripts\prepare-native.ps1
#   .\scripts\prepare-native.ps1 -WithSidecars

param(
  [switch]$WithSidecars
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Repo = Split-Path -Parent $Root
$HelperManifest = Join-Path $Root "native\keystore-helper\Cargo.toml"
$BinDir = Join-Path $Root "src-tauri\binaries"
$ResDir = Join-Path $Root "src-tauri\resources"
$ResBin = Join-Path $ResDir "bin"
$TargetTriple = "x86_64-pc-windows-msvc"

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
New-Item -ItemType Directory -Force -Path $ResDir | Out-Null
New-Item -ItemType Directory -Force -Path $ResBin | Out-Null

Write-Host "==> Building vireon-keystore-helper (release)"
cargo build --release --locked --manifest-path $HelperManifest
if ($LASTEXITCODE -ne 0) { throw "keystore helper build failed" }

$HelperSrc = Join-Path $Root "native\keystore-helper\target\release\vireon-keystore-helper.exe"
if (-not (Test-Path $HelperSrc)) {
  throw "Missing built helper: $HelperSrc"
}

$HelperDst = Join-Path $BinDir "vireon-keystore-helper-$TargetTriple.exe"
Copy-Item $HelperSrc $HelperDst -Force
Copy-Item $HelperSrc (Join-Path $BinDir "vireon-keystore-helper.exe") -Force
Copy-Item $HelperSrc (Join-Path $ResBin "vireon-keystore-helper.exe") -Force
Write-Host "Staged keystore helper -> $HelperDst"

$repoOperator = Join-Path $Repo "vireon.ps1"
if (Test-Path $repoOperator) {
  Copy-Item $repoOperator (Join-Path $ResDir "vireon.ps1") -Force
  Write-Host "  + vireon.ps1"
}

$logoCandidates = @(
  (Join-Path $Root "logo.png"),
  (Join-Path $Repo "logo.png"),
  (Join-Path $Repo "shared\brand\logo-mark.png")
)
foreach ($logo in $logoCandidates) {
  if (Test-Path $logo) {
    Copy-Item $logo (Join-Path $Root "public\logo.png") -Force
    break
  }
}

if ($WithSidecars) {
  Write-Host "==> Building monorepo release sidecars (Windows)"
  Push-Location $Repo
  try {
    # Release sidecars must contain real CUDA kernels; no stub/fallback is shippable.
    $env:VIREON_REQUIRE_CUDA = "1"
    cargo build --release --locked -p vireon-miner
    if ($LASTEXITCODE -ne 0) { throw "CUDA-enabled vireon-miner build failed" }
    cargo build --release --locked -p vireon-node -p vireon-rpc-gateway -p vireon-indexer
    if ($LASTEXITCODE -ne 0) { throw "Vireon sidecar build failed" }
  } finally {
    Pop-Location
  }

  $bins = @("vireon-miner", "vireon-node", "vireon-rpc-gateway", "vireon-indexer")
  foreach ($name in $bins) {
    $src = Join-Path $Repo "target\release\$name.exe"
    if (Test-Path $src) {
      Copy-Item $src (Join-Path $ResBin "$name.exe") -Force
      Write-Host "  + bin\$name.exe"
    } else {
      Write-Host "  ! missing $name.exe"
    }
  }

  $Stage = Join-Path $Repo "vireon-desktop\installer\stage"
  if (Test-Path $Stage) {
    Write-Host "==> Syncing optional installer stage extras"
    foreach ($item in @("scripts", "configs", "docs", "explorer")) {
      $from = Join-Path $Stage $item
      if (Test-Path $from) {
        $to = Join-Path $ResDir $item
        if (Test-Path $to) { Remove-Item $to -Recurse -Force }
        Copy-Item $from $to -Recurse -Force
        Write-Host "  + $item"
      }
    }
  }

  $manifest = @{
    prepared_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    platform = "windows"
    keystore_helper = "bin/vireon-keystore-helper.exe"
    binaries = @(
      "bin/vireon-miner.exe",
      "bin/vireon-node.exe",
      "bin/vireon-rpc-gateway.exe",
      "bin/vireon-indexer.exe"
    )
    operator = "vireon.ps1"
    mining_backend = "cuda"
    cpu_mining = $false
    opencl_mining = $false
  } | ConvertTo-Json
  Set-Content -Path (Join-Path $ResDir "MANIFEST.json") -Value $manifest -Encoding UTF8
  Write-Host "Wrote resources/MANIFEST.json"
}

Write-Host "Native preparation complete."

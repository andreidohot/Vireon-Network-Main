# Bump product line + workspace package versions together.
# Usage: ./scripts/release/bump-version.ps1 -Version 0.8.1
param(
    [Parameter(Mandatory = $true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Set-Location $root

if ($Version -notmatch '^\d+\.\d+\.\d+') {
    throw "Version must look like X.Y.Z (got $Version)"
}

$parts = $Version -split '\.'
# Android requires a monotonically increasing integer across product lines.
# X.Y.Z -> XYYYZZZ (1.0.0 = 1,000,000; 1.2.3 = 1,002,003).
$code = [int]$parts[0] * 1000000 + [int]$parts[1] * 1000 + [int]$parts[2]

# PowerShell 5 "utf8" encoding writes a BOM which breaks tauri.conf.json and some parsers.
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
function Write-Utf8NoBom([string]$Path, [string]$Content) {
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

Write-Utf8NoBom (Join-Path $root "VERSION") $Version
Write-Utf8NoBom (Join-Path $root "vireon-release/vps-control-plane/VERSION") $Version

$cargoDirs = @(
    "vireon-core", "vireon-node", "vireon-rpc-gateway", "vireon-wallet", "vireon-indexer",
    "vireon-miner", "vireon-mining-pool", "vireon-desktop", "vireon-mobile-core", "vireon-sdk-rust",
    "vireon-browser/host", "vireon-release/vps-control-plane/admin-server",
    "vireon-desktop-tauri/src-tauri", "vireon-desktop-tauri/native/keystore-helper"
)
foreach ($rel in $cargoDirs) {
    $p = Join-Path (Join-Path $root $rel) "Cargo.toml"
    if (-not (Test-Path $p)) { continue }
    $c = Get-Content $p -Raw
    $c = [regex]::Replace($c, '(?m)^version = "[^"]+"', "version = `"$Version`"", 1)
    Write-Utf8NoBom $p $c
    Write-Host "Cargo $rel -> $Version"
}

$npmFiles = @(
    "vireon-desktop-tauri/package.json",
    "vireon-explorer/package.json",
    "vireon-sdk/package.json",
    "vireon-examples/package.json",
    "vireon-website/package.json",
    "vireon-website/server/package.json"
)
foreach ($rel in $npmFiles) {
    $p = Join-Path $root $rel
    if (-not (Test-Path $p)) { continue }
    $c = Get-Content $p -Raw
    $c = [regex]::Replace($c, '(?m)("version"\s*:\s*")[^"]+("\s*,)', "`${1}$Version`${2}", 1)
    Write-Utf8NoBom $p $c
    Write-Host "npm $rel -> $Version"
}

$tauri = Join-Path $root "vireon-desktop-tauri/src-tauri/tauri.conf.json"
if (Test-Path $tauri) {
    $c = Get-Content $tauri -Raw
    $c = $c -replace '"version"\s*:\s*"[^"]+"', "`"version`": `"$Version`""
    Write-Utf8NoBom $tauri $c
    Write-Host "tauri.conf.json -> $Version"
}

$desktopConstants = Join-Path $root "vireon-desktop-tauri/shared/constants.ts"
if (Test-Path $desktopConstants) {
    $c = Get-Content $desktopConstants -Raw
    $c = $c -replace 'APP_VERSION\s*=\s*"[^"]+"', "APP_VERSION = `"$Version`""
    Write-Utf8NoBom $desktopConstants $c
    Write-Host "desktop APP_VERSION -> $Version"
}

$pkg = Join-Path $root "vireon-desktop-tauri/packaging/arch/PKGBUILD"
if (Test-Path $pkg) {
    $c = Get-Content $pkg -Raw
    $c = $c -replace 'pkgver=[\d.]+', "pkgver=$Version"
    Write-Utf8NoBom $pkg $c
    Write-Host "PKGBUILD -> $Version"
}

$ag = Join-Path $root "vireon-android/app/build.gradle.kts"
if (Test-Path $ag) {
    $c = Get-Content $ag -Raw
    $c = $c -replace 'versionCode = \d+', "versionCode = $code"
    $c = $c -replace 'versionName = "[^"]+"', "versionName = `"$Version`""
    $c = $c -replace 'PRODUCT_LINE", "\\"[^\\"]+\\""', "PRODUCT_LINE`", `"\`"$Version\`"`""
    Write-Utf8NoBom $ag $c
    Write-Host "Android versionCode=$code versionName=$Version"
}

Write-Host "Done. Root VERSION=$Version. Commit apps + crates together."

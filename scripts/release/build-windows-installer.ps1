param(
    [switch]$SkipChecks,
    [switch]$StageOnly
)

# Builds Vireon Control Center (Tauri 2) for Windows — NSIS/MSI + portable stage.
# Product path: Tauri only (vireon-desktop-tauri).

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$desktop = Join-Path $workspace "vireon-desktop-tauri"
$artifacts = Join-Path $workspace "release-artifacts"
$tauriConf = Join-Path $desktop "src-tauri\tauri.conf.json"
$bundleRoot = Join-Path $desktop "src-tauri\target\release\bundle"

if (-not (Test-Path -LiteralPath $desktop)) {
    throw "Tauri desktop project not found: $desktop"
}
if (-not (Test-Path -LiteralPath $tauriConf)) {
    throw "Missing tauri.conf.json at $tauriConf"
}

$toolchain = Join-Path $env:USERPROFILE ".rustup\toolchains\stable-x86_64-pc-windows-msvc\bin"
if (Test-Path -LiteralPath $toolchain) {
    $env:PATH = "$toolchain;$env:PATH"
}

$tauriJson = Get-Content -Raw -LiteralPath $tauriConf | ConvertFrom-Json
$version = [string]$tauriJson.version
if ([string]::IsNullOrWhiteSpace($version)) {
    throw "Could not read version from tauri.conf.json"
}
Write-Host "Building Vireon Control Center (Tauri) version $version"

if (-not $SkipChecks) {
    Push-Location $workspace
    try {
        cargo fmt --all --check
        if ($LASTEXITCODE -ne 0) { throw "cargo fmt failed" }
        cargo test --workspace --locked
        if ($LASTEXITCODE -ne 0) { throw "cargo test failed" }
        cargo clippy --workspace --all-targets --locked -- -D warnings
        if ($LASTEXITCODE -ne 0) { throw "cargo clippy failed" }
    } finally {
        Pop-Location
    }
}

New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
Get-ChildItem -LiteralPath $artifacts -File | Where-Object {
    $_.Name -like "Vireon Control Center_*.msi" -or
    $_.Name -like "Vireon Control Center_*-setup.exe" -or
    $_.Name -like "Vireon-Control-Center-*-Windows-x64-Portable.zip" -or
    $_.Name -eq "README-UPDATES.txt"
} | Remove-Item -Force
Get-ChildItem -LiteralPath $artifacts -Directory -Filter ".portable-stage-*" | ForEach-Object {
    if (-not $_.FullName.StartsWith($artifacts, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean unexpected portable stage: $($_.FullName)"
    }
    Remove-Item -LiteralPath $_.FullName -Recurse -Force
}

# Tauri retains bundles from earlier versions; never recollect stale installers.
if (Test-Path -LiteralPath $bundleRoot) {
    $resolvedBundleRoot = (Resolve-Path -LiteralPath $bundleRoot).Path
    if (-not $resolvedBundleRoot.StartsWith($desktop, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean unexpected bundle path: $resolvedBundleRoot"
    }
    Remove-Item -LiteralPath $resolvedBundleRoot -Recurse -Force
}

Push-Location $desktop
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed in vireon-desktop-tauri" }

    # Keystore helper + optional miner/node sidecars for full operator builds
    npm run prepare:native:sidecars
    if ($LASTEXITCODE -ne 0) { throw "prepare:native:sidecars failed" }

    if ($StageOnly) {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
        npx tauri build --no-bundle
        if ($LASTEXITCODE -ne 0) { throw "tauri build --no-bundle failed" }
        $exeCandidates = @(
            (Join-Path $desktop "src-tauri\target\release\vireon-desktop-tauri.exe"),
            (Join-Path $desktop "src-tauri\target\release\Vireon Control Center.exe")
        ) | Where-Object { Test-Path -LiteralPath $_ }
        if (-not $exeCandidates) {
            throw "StageOnly: release binary not found under src-tauri/target/release"
        }
        $stage = Join-Path $artifacts "tauri-stage-$version"
        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $stage | Out-Null
        Copy-Item -LiteralPath $exeCandidates[0] -Destination (Join-Path $stage "Vireon Control Center.exe")
        Write-Host "StageOnly binary: $stage"
        exit 0
    }

    npx tauri build --bundles nsis,msi
    if ($LASTEXITCODE -ne 0) { throw "Tauri NSIS/MSI build failed" }
} finally {
    Pop-Location
}

# Collect installers into release-artifacts with versioned names
if (-not (Test-Path -LiteralPath $bundleRoot)) {
    throw "No Tauri bundle directory at $bundleRoot"
}

$copied = @()
Get-ChildItem -Path $bundleRoot -Recurse -File | Where-Object {
    $_.Extension -in @(".exe", ".msi") -or $_.Name -like "*.nsis.zip"
} | ForEach-Object {
    $dest = Join-Path $artifacts $_.Name
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
    $copied += $dest
    Write-Host "Artifact: $dest"
}

# Portable zip of the release exe when present
$releaseExe = Get-ChildItem -Path (Join-Path $desktop "src-tauri\target\release") -File -Filter "*.exe" |
    Where-Object { $_.Name -match "Vireon|vireon-desktop" } |
    Select-Object -First 1
if ($releaseExe) {
    $portable = Join-Path $artifacts "Vireon-Control-Center-$version-Windows-x64-Portable.zip"
    $portableStage = Join-Path $artifacts ".portable-stage-$version"
    if (Test-Path -LiteralPath $portable) { Remove-Item -LiteralPath $portable -Force }
    if (Test-Path -LiteralPath $portableStage) { Remove-Item -LiteralPath $portableStage -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $portableStage | Out-Null
    Copy-Item -LiteralPath $releaseExe.FullName -Destination (Join-Path $portableStage "Vireon Control Center.exe")
    $releaseResources = Join-Path $desktop "src-tauri\target\release\resources"
    if (-not (Test-Path -LiteralPath $releaseResources)) {
        throw "Portable package resources are missing: $releaseResources"
    }
    Copy-Item -LiteralPath $releaseResources -Destination (Join-Path $portableStage "resources") -Recurse
    $keystoreHelper = Join-Path $desktop "src-tauri\target\release\vireon-keystore-helper.exe"
    if (-not (Test-Path -LiteralPath $keystoreHelper)) {
        throw "Portable package keystore helper is missing: $keystoreHelper"
    }
    Copy-Item -LiteralPath $keystoreHelper -Destination (Join-Path $portableStage "vireon-keystore-helper.exe")
    & tar.exe -a -cf $portable -C $portableStage .
    if ($LASTEXITCODE -ne 0) { throw "Portable zip creation failed" }
    $portableEntries = @(& tar.exe -tf $portable)
    if ($LASTEXITCODE -ne 0) { throw "Portable zip verification failed" }
    foreach ($requiredEntry in @(
        "./Vireon Control Center.exe",
        "./resources/bin/vireon-miner.exe",
        "./vireon-keystore-helper.exe"
    )) {
        if ($portableEntries -notcontains $requiredEntry) {
            throw "Portable zip is incomplete; missing $requiredEntry"
        }
    }
    Remove-Item -LiteralPath $portableStage -Recurse -Force
    $copied += $portable
    Write-Host "Portable package: $portable"
}

# Honest updater note (no legacy electron-builder latest.yml)
$readme = Join-Path $artifacts "README-UPDATES.txt"
@(
    "Vireon Control Center Tauri $version",
    "The app checks GitHub Releases but requires explicit approval before installation.",
    "Each selected asset must match the release SHA256SUMS file before execution.",
    "Packages are not Authenticode-signed yet; verify the publisher and checksum before approval.",
    "Do not use legacy electron-builder latest.yml channels."
) | Set-Content -LiteralPath $readme -Encoding utf8

if (-not $copied) {
    throw "No Windows installer artifacts were produced under $bundleRoot"
}

Write-Host "Windows Tauri packaging complete ($($copied.Count) artifacts) version $version"

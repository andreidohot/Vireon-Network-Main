$ErrorActionPreference = "Stop"

if ($args -contains "--help" -or $args -contains "-h" -or $args -contains "-Help") {
  Write-Host "Usage: scripts/release/release-gate.ps1"
  Write-Host "Runs G1: local Mainnet Candidate software/hygiene release gate."
  Write-Host "Passing does NOT approve public Mainnet launch. See docs/release/NETWORK_MATURITY.md."
  exit 0
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

$cargoShim = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
$originalCargoTargetDir = $env:CARGO_TARGET_DIR
$originalPath = $env:PATH
$rustToolchainBin = Join-Path $env:USERPROFILE ".rustup\toolchains\stable-x86_64-pc-windows-msvc\bin"
$tempCargoTargetDir = Join-Path ([System.IO.Path]::GetTempPath()) ("vireon-release-gate-target-" + [System.Guid]::NewGuid().ToString("N"))
if (Test-Path $cargoShim) {
  $cargo = $cargoShim
  $cargoArgsPrefix = @("+stable-x86_64-pc-windows-msvc")
} else {
  $cargo = "cargo"
  $cargoArgsPrefix = @()
}
$env:CARGO_TARGET_DIR = $tempCargoTargetDir
if (Test-Path $rustToolchainBin) {
  $env:PATH = "$rustToolchainBin;$env:PATH"
}

function Assert-PathExists {
  param(
    [string]$Path,
    [string]$Description
  )

  if (-not (Test-Path $Path)) {
    throw "$Description is missing at $Path"
  }
}

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Native command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
  }
}

Write-Host "Running Vireon G1 security and release gate (Mainnet Candidate rehearsal only)..."
Write-Host "This is NOT a public Mainnet launch approval. See docs/release/NETWORK_MATURITY.md"

try {
  foreach ($buildArtifact in @(
    (Join-Path $repoRoot "target"),
    (Join-Path $repoRoot "target-msvc"),
    (Join-Path $repoRoot "vireon-explorer\node_modules"),
    (Join-Path $repoRoot "vireon-website\node_modules"),
    (Join-Path $repoRoot "vireon-website\server\node_modules")
  )) {
    if (Test-Path $buildArtifact) {
      Remove-Item -LiteralPath $buildArtifact -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  & (Join-Path $repoRoot "scripts\security\check-secrets.ps1")
  & (Join-Path $repoRoot "scripts\security\check-repo-hygiene.ps1")
  & (Join-Path $repoRoot "scripts\security\check-config-safety.ps1")
  & (Join-Path $repoRoot "scripts\security\check-workflow-pinning.ps1")

  Assert-PathExists "configs/mainnet-candidate.toml" "Mainnet-candidate config"
  Assert-PathExists "docs/release/MAINNET_CANDIDATE_CHECKLIST.md" "Mainnet-candidate checklist"
  Assert-PathExists "docs/release/RELEASE_GATE.md" "Release gate documentation"
  Assert-PathExists "docs/release/NETWORK_MATURITY.md" "Network maturity documentation"
  Assert-PathExists "docs/security/SECURITY_GATE.md" "Security gate documentation"
  Assert-PathExists "docs/security/SECRET_HANDLING.md" "Secret handling documentation"
  Assert-PathExists "docs/release/GENESIS.md" "Genesis documentation"

  Invoke-NativeChecked $cargo @cargoArgsPrefix fmt --all --check
  Invoke-NativeChecked $cargo @cargoArgsPrefix test --workspace --locked
  Invoke-NativeChecked $cargo @cargoArgsPrefix clippy --workspace --all-targets --locked -- -D warnings
  Invoke-NativeChecked $cargo @cargoArgsPrefix build --workspace --release --locked

  if (Test-Path "vireon-explorer\package.json") {
    Push-Location vireon-explorer
    try {
      Invoke-NativeChecked "npm.cmd" "ci"
      Invoke-NativeChecked "npm.cmd" "run" "build"
    } finally {
      Pop-Location
    }
  }
} finally {
  if (Test-Path $tempCargoTargetDir) {
    Remove-Item -LiteralPath $tempCargoTargetDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  foreach ($nodeModules in @(
    (Join-Path $repoRoot "vireon-explorer\node_modules"),
    (Join-Path $repoRoot "vireon-website\node_modules"),
    (Join-Path $repoRoot "vireon-website\server\node_modules")
  )) {
    if (Test-Path $nodeModules) {
      Remove-Item -LiteralPath $nodeModules -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  if ($null -ne $originalCargoTargetDir -and $originalCargoTargetDir -ne "") {
    $env:CARGO_TARGET_DIR = $originalCargoTargetDir
  } else {
    Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
  }
  $env:PATH = $originalPath
}

Write-Host ""
Write-Host "G1 release gate PASSED (Mainnet Candidate software/hygiene only)."
Write-Host "NOT a public Mainnet approval. Next: G2 checklist + NETWORK_MATURITY.md G4 for launch."

# Verify existing clean PR worktrees (A-D) with the right cargo tests.
# Does NOT commit or push.
#
# Usage:
#   .\scripts\browser\verify-pr-worktrees.ps1
#   .\scripts\browser\verify-pr-worktrees.ps1 -Pr B
#   .\scripts\browser\verify-pr-worktrees.ps1 -Pr All -SkipMissing

[CmdletBinding()]
param(
    [ValidateSet("All", "A", "B", "C", "D", "E")]
    [string]$Pr = "All",
    [switch]$SkipMissing
)

$ErrorActionPreference = "Stop"
$Parent = Split-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path -Parent

$suite = [ordered]@{
    A = @{
        Path = Join-Path $Parent "vireon-pr-a"
        Commands = @(
            "cargo test -p vireon-sdk-rust --all-features"
        )
    }
    B = @{
        Path = Join-Path $Parent "vireon-pr-b"
        Commands = @(
            "cargo test -p vireon-sdk-rust --all-features"
            "cargo test -p vireon-wallet --tests"
        )
    }
    C = @{
        Path = Join-Path $Parent "vireon-pr-c"
        Commands = @(
            "cargo test -p vireon-sdk-rust --all-features"
            "cargo test -p vireon-browser-host"
        )
    }
    D = @{
        Path = Join-Path $Parent "vireon-pr-d"
        Commands = @(
            "cargo test -p vireon-sdk-rust --all-features"
            "cargo test -p vireon-browser-host"
            "cargo run -p vireon-browser-host -- --check-health --require-indexer-sync --json"
        )
    }
    E = @{
        Path = Join-Path $Parent "vireon-pr-e"
        Commands = @(
            "cargo test -p vireon-sdk-rust --all-features"
            # Tauri conf requires externalBin keystore helper (not committed).
            "powershell -NoProfile -ExecutionPolicy Bypass -File vireon-desktop-tauri/scripts/prepare-native.ps1"
            "cargo test --manifest-path vireon-desktop-tauri/src-tauri/Cargo.toml --lib"
        )
    }
}

$keys = if ($Pr -eq "All") { @("A", "B", "C", "D", "E") } else { @($Pr) }
$failed = @()

foreach ($k in $keys) {
    $item = $suite[$k]
    Write-Host ""
    Write-Host "======== PR $k ========" -ForegroundColor Cyan
    if (-not (Test-Path $item.Path)) {
        if ($SkipMissing) {
            Write-Host "[skip] missing worktree: $($item.Path)" -ForegroundColor Yellow
            continue
        }
        throw "Missing worktree: $($item.Path)"
    }
    Set-Location $item.Path
    Write-Host "cwd: $($item.Path)"
    foreach ($cmd in $item.Commands) {
        Write-Host ">> $cmd" -ForegroundColor DarkGray
        Invoke-Expression $cmd
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[FAIL] PR $k exit $LASTEXITCODE for: $cmd" -ForegroundColor Red
            $failed += "PR $k : $cmd"
            break
        }
    }
}

Write-Host ""
if ($failed.Count -eq 0) {
    Write-Host "All requested worktree checks passed." -ForegroundColor Green
    exit 0
} else {
    Write-Host "Failures:" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host "  $_" }
    exit 1
}

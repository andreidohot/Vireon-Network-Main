# Print suggested git pathspecs for the SDK/browser/health PR stack.
# Does NOT stage or commit anything.
#
# Usage:
#   .\scripts\browser\print-epic-pr-paths.ps1
#   .\scripts\browser\print-epic-pr-paths.ps1 -Pr A
#   .\scripts\browser\print-epic-pr-paths.ps1 -Pr D -AsGitAdd

[CmdletBinding()]
param(
    [ValidateSet("All", "A", "B", "C", "D", "E")]
    [string]$Pr = "All",
    [switch]$AsGitAdd
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $RepoRoot

$plan = [ordered]@{
    A = @{
        Title = "feat(sdk): vireon-sdk-rust L1 client"
        Paths = @(
            "vireon-sdk-rust"
            "Cargo.toml"
            "Cargo.lock"
            "docs/api/04_SDK_CLIENT_V0.md"
            "docs/api/README.md"
        )
        Test = "cargo test -p vireon-sdk-rust --all-features"
    }
    B = @{
        Title = "feat(wallet): route CLI RPC through vireon-sdk-rust"
        Paths = @(
            "vireon-sdk-rust"
            "Cargo.toml"
            "vireon-wallet/Cargo.toml"
            "vireon-wallet/src/rpc.rs"
            "docs/api/04_SDK_CLIENT_V0.md"
            "docs/api/README.md"
        )
        Test = "cargo test -p vireon-sdk-rust --all-features; cargo test -p vireon-wallet --tests"
        Note = "Self-testable worktree includes SDK. After A merges, land only wallet paths."
    }
    C = @{
        Title = "feat(browser): native messaging host + extension"
        Paths = @(
            "vireon-sdk-rust"
            "vireon-browser"
            "Cargo.toml"
            "docs/architecture/07_BROWSER_EXTENSION_AND_NATIVE_HOST.md"
            "docs/architecture/README.md"
            "docs/api/04_SDK_CLIENT_V0.md"
            "docs/api/README.md"
        )
        Test = "cargo test -p vireon-sdk-rust --all-features; cargo test -p vireon-browser-host"
        Note = "Self-testable worktree includes SDK. After A merges, land only browser paths."
    }
    D = @{
        Title = "feat(ops): candidate chain health probes + CI"
        Paths = @(
            "scripts/browser"
            "scripts/README.md"
            ".github/workflows/candidate-chain-health.yml"
            "docs/operator/CHAIN_HEALTH.md"
            "docs/operator/UNCOMMITTED_SPLIT_PLAN.md"
            "README.md"
        )
        Test = "cargo test -p vireon-browser-host --test cli_print_tip"
    }
    E = @{
        Title = "feat(desktop-tauri): consume vireon-sdk-rust"
        Paths = @(
            "vireon-sdk-rust"
            "Cargo.toml"
            "vireon-desktop-tauri"
            "docs/api/04_SDK_CLIENT_V0.md"
            "docs/api/README.md"
        )
        Test = "cargo test -p vireon-sdk-rust --all-features; cd vireon-desktop-tauri/src-tauri; cargo test --lib"
        Note = "Self-testable with SDK. Exclude binaries/node_modules/target. After A merges, land tauri delta only."
    }
}

function Show-Pr([string]$key) {
    $item = $plan[$key]
    Write-Host ""
    Write-Host "=== PR $key - $($item.Title) ===" -ForegroundColor Cyan
    Write-Host "Test: $($item.Test)" -ForegroundColor DarkGray
    Write-Host "Paths:"
    foreach ($p in $item.Paths) {
        $exists = Test-Path (Join-Path $RepoRoot $p)
        $mark = if ($exists) { "[ok]" } else { "[missing]" }
        Write-Host ("  {0} {1}" -f $mark, $p)
        if ($AsGitAdd -and $exists) {
            Write-Host ("    git add -- {0}" -f $p) -ForegroundColor Yellow
        }
    }
    if ($AsGitAdd) {
        $joined = ($item.Paths -join " ")
        Write-Host ""
        Write-Host "One-liner (review before running):" -ForegroundColor Yellow
        Write-Host ("  git add -- {0}" -f $joined)
    }
}

Write-Host "Repo: $RepoRoot"
Write-Host "No files are staged by this script."
Write-Host "Full plan: docs/operator/UNCOMMITTED_SPLIT_PLAN.md"

if ($Pr -eq "All") {
    foreach ($k in @("A", "B", "C", "D", "E")) { Show-Pr $k }
} else {
    Show-Pr $Pr
}

Write-Host ""
Write-Host "Before any PR: git fetch origin; git rebase origin/main" -ForegroundColor Magenta
Write-Host "Exclude by default: electron, android assets, miner GPU, vireon-release, .review, pipeline" -ForegroundColor DarkGray

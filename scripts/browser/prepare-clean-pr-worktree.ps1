# Create a clean git worktree from origin/main for an epic PR (A-E).
# Copies ONLY the pathspecs for that PR from the current dirty workspace.
# Does NOT commit, push, or modify the main working tree beyond worktree add.
#
# Usage:
#   git fetch origin
#   .\scripts\browser\prepare-clean-pr-worktree.ps1 -Pr A
#   .\scripts\browser\prepare-clean-pr-worktree.ps1 -Pr D -BranchName feat/ops-chain-health
#
# Then in the worktree:
#   cd <worktree>
#   cargo test ...
#   git add ...; git commit   # when YOU decide

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("A", "B", "C", "D", "E")]
    [string]$Pr,

    [string]$BranchName = "",

    [string]$WorktreeRoot = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $RepoRoot

# Ensure we know origin/main
git rev-parse --verify origin/main | Out-Null

$pathsByPr = @{
    A = @(
        "vireon-sdk-rust",
        "Cargo.toml",
        "Cargo.lock",
        "docs/api/04_SDK_CLIENT_V0.md",
        "docs/api/README.md"
    )
    # B needs SDK (path dep + workspace member) to compile on a clean base.
    B = @(
        "vireon-sdk-rust",
        "Cargo.toml",
        "vireon-wallet/Cargo.toml",
        "vireon-wallet/src/rpc.rs",
        "docs/api/04_SDK_CLIENT_V0.md",
        "docs/api/README.md"
    )
    # C needs SDK (path dep + workspace member).
    C = @(
        "vireon-sdk-rust",
        "vireon-browser",
        "Cargo.toml",
        "docs/architecture/07_BROWSER_EXTENSION_AND_NATIVE_HOST.md",
        "docs/architecture/README.md",
        "docs/api/04_SDK_CLIENT_V0.md",
        "docs/api/README.md"
    )
    # D CI builds the host; include sdk+browser so the worktree is self-testable.
    D = @(
        "vireon-sdk-rust",
        "vireon-browser",
        "Cargo.toml",
        "scripts/browser",
        "scripts/README.md",
        ".github/workflows/candidate-chain-health.yml",
        "docs/operator/CHAIN_HEALTH.md",
        "docs/operator/UNCOMMITTED_SPLIT_PLAN.md",
        "docs/api/04_SDK_CLIENT_V0.md",
        "docs/api/README.md",
        "docs/architecture/07_BROWSER_EXTENSION_AND_NATIVE_HOST.md",
        "docs/architecture/README.md",
        "README.md"
    )
    # E: Tauri is its own Cargo workspace; still needs monorepo vireon-sdk-rust on disk
    # (path deps from src-tauri and native/keystore-helper).
    E = @(
        "vireon-sdk-rust",
        "Cargo.toml",
        "vireon-desktop-tauri",
        "docs/api/04_SDK_CLIENT_V0.md",
        "docs/api/README.md"
    )
}

$defaultBranch = @{
    A = "feat/vireon-sdk-rust-client"
    B = "feat/wallet-sdk-rpc"
    C = "feat/browser-native-host"
    D = "feat/ops-chain-health"
    E = "feat/desktop-tauri-sdk"
}

if (-not $BranchName) { $BranchName = $defaultBranch[$Pr] }
if (-not $WorktreeRoot) {
    $WorktreeRoot = Join-Path (Split-Path $RepoRoot -Parent) ("vireon-pr-" + $Pr.ToLower())
}

$paths = $pathsByPr[$Pr]
Write-Host "Source (dirty) repo : $RepoRoot"
Write-Host "Base                : origin/main"
Write-Host "Branch              : $BranchName"
Write-Host "Worktree            : $WorktreeRoot"
Write-Host "PR                  : $Pr"
Write-Host ""

if (Test-Path $WorktreeRoot) {
    throw "Worktree path already exists: $WorktreeRoot (remove it or choose another -WorktreeRoot)"
}

# Create worktree on a new branch from origin/main
git worktree add -b $BranchName $WorktreeRoot origin/main
if ($LASTEXITCODE -ne 0) { throw "git worktree add failed" }

# Copy pathspecs from dirty workspace into clean worktree.
# Special-case Cargo.toml: never blind-copy the dirty workspace file (it may list
# members not present in this PR). Instead patch origin/main members list.
foreach ($rel in $paths) {
    if ($rel -eq "Cargo.toml") {
        $dstToml = Join-Path $WorktreeRoot "Cargo.toml"
        $text = Get-Content -Raw $dstToml
        $changed = $false
        if ($Pr -in @("A", "B", "C", "D", "E") -and $text -notmatch '"vireon-sdk-rust"') {
            $text = $text -replace '("vireon-wallet",\r?\n)', "`$1    `"vireon-sdk-rust`",`n"
            $changed = $true
            Write-Host "[patched]     Cargo.toml (+ vireon-sdk-rust)"
        }
        if ($Pr -in @("C", "D") -and $text -notmatch 'vireon-browser/host') {
            # Insert host after sdk if present, else after wallet
            if ($text -match '"vireon-sdk-rust"') {
                $text = $text -replace '("vireon-sdk-rust",\r?\n)', "`$1    `"vireon-browser/host`",`n"
            } else {
                $text = $text -replace '("vireon-wallet",\r?\n)', "`$1    `"vireon-browser/host`",`n"
            }
            $changed = $true
            Write-Host "[patched]     Cargo.toml (+ vireon-browser/host)"
        }
        if ($changed) {
            Set-Content -Path $dstToml -Value $text -NoNewline -Encoding utf8
        } else {
            Write-Host "[kept]        Cargo.toml (already has members or N/A)"
        }
        continue
    }
    if ($rel -eq "Cargo.lock") {
        Write-Host "[skip]        Cargo.lock (regenerate with cargo test/build in worktree)"
        continue
    }

    $src = Join-Path $RepoRoot $rel
    $dst = Join-Path $WorktreeRoot $rel
    if (-not (Test-Path $src)) {
        Write-Host "[skip missing] $rel" -ForegroundColor Yellow
        continue
    }
    $dstParent = Split-Path $dst -Parent
    if ($dstParent -and -not (Test-Path $dstParent)) {
        New-Item -ItemType Directory -Force -Path $dstParent | Out-Null
    }
    if (Test-Path $src -PathType Container) {
        if ($rel -eq "vireon-desktop-tauri") {
            # Origin already has a Tauri tree; overlay dirty SDK-wired sources without
            # build artifacts / sidecar binaries / node_modules.
            if (-not (Test-Path $dst)) {
                New-Item -ItemType Directory -Force -Path $dst | Out-Null
            }
            $xd = @("node_modules", "target", "dist", "dist-ssr", ".vite")
            $xf = @("*.exe", "*.pdb", "*.log")
            $robolog = Join-Path $env:TEMP ("vireon-pr-e-robocopy-{0}.log" -f [guid]::NewGuid().ToString("n"))
            $roboArgs = @($src, $dst, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np", "/R:1", "/W:1", "/LOG:$robolog")
            foreach ($d in $xd) { $roboArgs += @("/XD", $d) }
            foreach ($f in $xf) { $roboArgs += @("/XF", $f) }
            & robocopy @roboArgs | Out-Null
            $rc = $LASTEXITCODE
            # robocopy: 0-7 success-ish, >=8 failure
            if ($rc -ge 8) {
                throw "robocopy failed for vireon-desktop-tauri (exit $rc); log: $robolog"
            }
            # Drop generated sidecar copies that must not enter git.
            $binDir = Join-Path $dst "src-tauri\binaries"
            if (Test-Path $binDir) {
                Get-ChildItem $binDir -File -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -ne ".gitkeep" } |
                    Remove-Item -Force -ErrorAction SilentlyContinue
            }
            $resBin = Join-Path $dst "src-tauri\resources\bin"
            if (Test-Path $resBin) {
                Remove-Item -Recurse -Force $resBin -ErrorAction SilentlyContinue
            }
            Write-Host "[overlay dir] $rel (excluded node_modules/target/dist/*.exe)"
            Remove-Item $robolog -Force -ErrorAction SilentlyContinue
        } else {
            if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
            Copy-Item -Recurse -Force $src $dst
            Write-Host "[copied dir]  $rel"
        }
    } else {
        Copy-Item -Force $src $dst
        Write-Host "[copied file] $rel"
    }
}

Write-Host ""
Write-Host "Worktree ready. Next (manual):" -ForegroundColor Green
Write-Host "  cd `"$WorktreeRoot`""
Write-Host "  git status -sb"
Write-Host "  # run tests for this PR"
Write-Host "  git add -A"
Write-Host "  git status"
Write-Host "  # git commit when you choose"
Write-Host "  # git push -u origin $BranchName"
Write-Host ""
Write-Host "Remove worktree later:"
Write-Host "  cd `"$RepoRoot`""
Write-Host "  git worktree remove `"$WorktreeRoot`""
Write-Host "  git branch -D $BranchName   # if abandoned"

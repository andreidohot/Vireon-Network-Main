# Probe Mainnet Candidate chain via vireon-browser-host one-shots.
#
# Usage:
#   .\scripts\browser\probe-chain.ps1
#   .\scripts\browser\probe-chain.ps1 -Local
#   .\scripts\browser\probe-chain.ps1 -Strict
#   .\scripts\browser\probe-chain.ps1 -Watch -IntervalSec 15 -Strict
#   .\scripts\browser\probe-chain.ps1 -Strict -WebhookUrl $env:VIREON_HEALTH_WEBHOOK_URL

[CmdletBinding()]
param(
    [string]$Rpc = "",
    [switch]$Local,
    [switch]$Build,
    [switch]$Json,
    [switch]$Quiet,
    [switch]$IncludeBlock,
    [Nullable[uint64]]$Height = $null,
    [switch]$Strict,
    [Nullable[uint64]]$MaxIndexerLag = $null,
    [switch]$Watch,
    [int]$IntervalSec = 15,
    [int]$MaxIterations = 0,
    [string]$WebhookUrl = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $RepoRoot

if ([string]::IsNullOrWhiteSpace($WebhookUrl) -and $env:VIREON_HEALTH_WEBHOOK_URL) {
    $WebhookUrl = $env:VIREON_HEALTH_WEBHOOK_URL
}

if ($Build) {
    Write-Host "Building vireon-browser-host..."
    cargo build -q -p vireon-browser-host
}

$binCandidates = @(
    (Join-Path $RepoRoot "target\debug\vireon-browser-host.exe"),
    (Join-Path $RepoRoot "target\release\vireon-browser-host.exe")
)
$HostBin = $binCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $HostBin) {
    Write-Host "Host binary missing; building..."
    cargo build -q -p vireon-browser-host
    $HostBin = Join-Path $RepoRoot "target\debug\vireon-browser-host.exe"
}
if (-not (Test-Path $HostBin)) {
    throw "Could not find vireon-browser-host.exe"
}

function Invoke-Host {
    param(
        [string[]]$HostArgs,
        [switch]$AllowNonZero
    )
    $all = @()
    if ($Local) { $all += "--local" }
    if ($Rpc) { $all += @("--rpc", $Rpc) }
    if ($Json) { $all += "--json" }
    $all += $HostArgs
    & $HostBin @all
    $code = $LASTEXITCODE
    if (-not $AllowNonZero -and $code -ne 0) {
        throw "vireon-browser-host failed ($code): $($HostArgs -join ' ')"
    }
    return $code
}

function Send-Webhook {
    param(
        [int]$Code,
        [string]$Body
    )
    if ([string]::IsNullOrWhiteSpace($WebhookUrl)) { return }
    try {
        $payload = @{
            text   = "Vireon Mainnet Candidate health FAILED"
            code   = $Code
            health = $Body
            host   = $env:COMPUTERNAME
            when   = (Get-Date).ToString("o")
        } | ConvertTo-Json -Depth 8
        Invoke-RestMethod -Method Post -Uri $WebhookUrl -ContentType "application/json" -Body $payload | Out-Null
        if (-not $Quiet) { Write-Host "Webhook notified." -ForegroundColor DarkYellow }
    } catch {
        Write-Host "Webhook failed: $_" -ForegroundColor DarkYellow
    }
}

function Invoke-ProbeOnce {
    if (-not $Quiet) {
        Write-Host "=== Vireon chain probe (Mainnet Candidate) $(Get-Date -Format o) ===" -ForegroundColor Cyan
        Write-Host "host: $HostBin"
        if ($Local) { Write-Host "rpc:  local loopback" }
        elseif ($Rpc) { Write-Host "rpc:  $Rpc" }
        else { Write-Host "rpc:  default public candidate" }
        Write-Host ""
    }

    if (-not $Quiet) { Write-Host "--check-health" -ForegroundColor Yellow }
    $healthArgs = @("--check-health", "--json")
    if ($Strict) { $healthArgs += "--require-indexer-sync" }
    if ($null -ne $MaxIndexerLag) { $healthArgs += @("--max-indexer-lag", "$MaxIndexerLag") }
    $healthOut = & $HostBin @(
        $(if ($Local) { "--local" } else { @() }) +
        $(if ($Rpc) { @("--rpc", $Rpc) } else { @() }) +
        $healthArgs
    ) 2>&1 | Out-String
    $healthCode = $LASTEXITCODE
    if (-not $Quiet) { Write-Host $healthOut }

    if ($healthCode -ne 0) {
        Send-Webhook -Code $healthCode -Body $healthOut
    }

    if (-not $Quiet) { Write-Host "--print-tip" -ForegroundColor Yellow }
    Invoke-Host @("--print-tip") | Out-Null
    if (-not $Quiet) { Write-Host "" }

    if (-not $Quiet) { Write-Host "--print-chain" -ForegroundColor Yellow }
    Invoke-Host @("--print-chain") | Out-Null
    if (-not $Quiet) { Write-Host "" }

    if ($IncludeBlock -or $null -ne $Height) {
        if (-not $Quiet) { Write-Host "--print-block" -ForegroundColor Yellow }
        if ($null -ne $Height) {
            Invoke-Host @("--print-block", "--height", "$Height") | Out-Null
        } else {
            Invoke-Host @("--print-block") | Out-Null
        }
        if (-not $Quiet) { Write-Host "" }
    }

    if (-not $Quiet) {
        if ($healthCode -eq 0) {
            Write-Host "Health OK (code 0). Mainnet Candidate / Prototype - not Mainnet Live." -ForegroundColor Green
        } else {
            Write-Host "Health FAILED (code $healthCode)." -ForegroundColor Red
        }
    }
    return $healthCode
}

if ($Watch) {
    if ($IntervalSec -lt 3) { $IntervalSec = 3 }
    $i = 0
    $lastCode = 0
    while ($true) {
        $i++
        try {
            $lastCode = Invoke-ProbeOnce
        } catch {
            Write-Host "probe error: $_" -ForegroundColor Red
            $lastCode = 1
            Send-Webhook -Code 1 -Body "$_"
        }
        if ($MaxIterations -gt 0 -and $i -ge $MaxIterations) {
            exit $lastCode
        }
        if (-not $Quiet) {
            Write-Host "Sleeping ${IntervalSec}s (Watch)... Ctrl+C to stop" -ForegroundColor DarkGray
        }
        Start-Sleep -Seconds $IntervalSec
    }
} else {
    $code = Invoke-ProbeOnce
    exit $code
}

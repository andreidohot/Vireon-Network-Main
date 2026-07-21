param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "status", "mine", "miner-start", "miner-stop", "validate", "backup", "wallet", "explorer", "smoke", "logs", "help")]
    [string]$Command = "help",
    [string]$MinerAddress,
    [int]$MinerThreads = 0,
    [string]$PoolUrl,
    [string]$WorkerName,
    [switch]$Desktop,
    [switch]$SkipExplorer,
    [ValidateSet("node", "rpc", "miner", "explorer")]
    [string]$Service = "node",
    [int]$Tail = 50
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Resolve install / monorepo root robustly for packaged Tauri layouts.
# $MyInvocation.MyCommand.Path can be empty when PowerShell is invoked in some hosts.
function Resolve-VireonWorkspace {
    $candidates = @()
    if ($PSScriptRoot) { $candidates += $PSScriptRoot }
    if ($MyInvocation.MyCommand.Path) {
        $parent = Split-Path -Parent $MyInvocation.MyCommand.Path -ErrorAction SilentlyContinue
        if ($parent) { $candidates += $parent }
    }
    if ($env:VIREON_WORKSPACE_ROOT) { $candidates += $env:VIREON_WORKSPACE_ROOT }
    try {
        $candidates += (Get-Location).Path
    } catch {}

    foreach ($candidate in $candidates) {
        if (-not $candidate) { continue }
        if (Test-Path -LiteralPath (Join-Path $candidate "bin\vireon-miner.exe")) { return (Resolve-Path $candidate).Path }
        if (Test-Path -LiteralPath (Join-Path $candidate "bin\vireon-node.exe")) { return (Resolve-Path $candidate).Path }
        if (Test-Path -LiteralPath (Join-Path $candidate "scripts\local\vireon-local.ps1")) { return (Resolve-Path $candidate).Path }
        if (Test-Path -LiteralPath (Join-Path $candidate "vireon-core\Cargo.toml")) { return (Resolve-Path $candidate).Path }
    }
    throw "Cannot resolve Vireon workspace. Set VIREON_WORKSPACE_ROOT to the install resources folder."
}

$workspace = Resolve-VireonWorkspace
$operator = Join-Path $workspace "scripts\local\vireon-local.ps1"
$rpcUrl = if ($env:VIREON_RPC_URL -and $env:VIREON_RPC_URL.Trim()) {
    $env:VIREON_RPC_URL.Trim().TrimEnd('/')
} else {
    "https://rpcnode.dohotstudio.com"
}
$explorerUrl = "http://127.0.0.1:4173"

function Show-Usage {
    Write-Host "Vireon Mainnet Candidate operator"
    Write-Host "Usage: .\vireon.ps1 <command>"
    Write-Host ""
    Write-Host "  miner-start  Start GPU miner against VPS RPC/pool (requires -MinerAddress)"
    Write-Host "  miner-stop   Stop the GPU miner"
    Write-Host "  status       Show remote RPC + local miner state"
    Write-Host ""
    Write-Host "Default RPC: $rpcUrl"
}

function Get-LocalRoot {
    if ($env:VIREON_LOCAL_ROOT -and $env:VIREON_LOCAL_ROOT.Trim()) {
        return $env:VIREON_LOCAL_ROOT.Trim()
    }
    if (Test-Path -LiteralPath (Join-Path $workspace "bin\vireon-miner.exe")) {
        $localApp = $env:LOCALAPPDATA
        if (-not $localApp) { $localApp = Join-Path $env:USERPROFILE "AppData\Local" }
        return (Join-Path $localApp "Vireon\ControlCenter\.vireon-local")
    }
    return (Join-Path $workspace ".vireon-local")
}

function Start-PackagedMiner {
    if (-not $MinerAddress) {
        throw "-MinerAddress is required (vire1... wallet address)."
    }
    $localRoot = Get-LocalRoot
    $minerDir = Join-Path $localRoot "miner"
    $logsDir = Join-Path $localRoot "logs"
    New-Item -ItemType Directory -Force -Path $minerDir, $logsDir | Out-Null
    $minerConfig = Join-Path $minerDir "config.toml"
    $metricsPath = (Join-Path $minerDir "metrics.json").Replace('\', '/')
    # Product mining is NVIDIA CUDA-only. MinerThreads is ignored.
    if ($MinerThreads -gt 0) {
        Write-Host "Note: -MinerThreads is deprecated (continuous CPU mining removed). Using GPU-only auto."
    }

    if ($PoolUrl) {
        $source = @"
[source]
kind = "pool"
url = "$($PoolUrl.TrimEnd('/'))"
worker_name = "$(if ($WorkerName) { $WorkerName } else { 'desktop-01' })"
timeout_seconds = 20
"@
    } else {
        $source = @"
[source]
kind = "rpc"
url = "$rpcUrl"
timeout_seconds = 20
"@
    }

    @"
schema_version = 3
miner_address = "$MinerAddress"
threads = 1
nonce_batch_size = 1048576
template_refresh_seconds = 5
status_interval_seconds = 10
backend_mode = "auto"
gpu_intensity = 90
kernel_validation = true
metrics_path = "$metricsPath"

$source
"@ | Set-Content -LiteralPath $minerConfig -Encoding UTF8

    $minerBinary = Join-Path $workspace "bin\vireon-miner.exe"
    if (-not (Test-Path -LiteralPath $minerBinary)) {
        throw "vireon-miner.exe missing at $minerBinary"
    }

    # Health probe
    try {
        $null = Invoke-RestMethod -Uri "$rpcUrl/health" -TimeoutSec 10
    } catch {
        throw "RPC gateway not ready at $rpcUrl : $($_.Exception.Message)"
    }

    $logOut = Join-Path $logsDir "miner.log"
    $logErr = Join-Path $logsDir "miner.err.log"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $minerBinary
    $psi.Arguments = "--config `"$minerConfig`" mine"
    $psi.WorkingDirectory = $workspace
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.Environment["VIREON_LOCAL_ROOT"] = $localRoot
    $psi.Environment["VIREON_WORKSPACE_ROOT"] = $workspace
    $psi.Environment["VIREON_RPC_URL"] = $rpcUrl
    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    # async log drain
    Start-Job -ScriptBlock {
        param($p, $out, $err)
        $p.StandardOutput.ReadToEnd() | Out-File -FilePath $out -Encoding utf8
        $p.StandardError.ReadToEnd() | Out-File -FilePath $err -Encoding utf8
    } -ArgumentList $proc, $logOut, $logErr | Out-Null
    Set-Content -LiteralPath (Join-Path $logsDir "miner.pid") -Value $proc.Id -Encoding ascii
    Write-Host "GPU miner started pid=$($proc.Id) config=$minerConfig rpc=$rpcUrl"
}

function Stop-PackagedMiner {
    $localRoot = Get-LocalRoot
    $pidFile = Join-Path $localRoot "logs\miner.pid"
    if (Test-Path -LiteralPath $pidFile) {
        $pid = (Get-Content -LiteralPath $pidFile -Raw).Trim()
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        if ($pid -match '^\d+$') {
            & taskkill.exe /PID $pid /T /F 2>$null | Out-Null
        }
    }
    & taskkill.exe /IM vireon-miner.exe /F 2>$null | Out-Null
    Write-Host "miner stop requested"
}

function Invoke-Operator([string]$OperatorCommand) {
    if (-not (Test-Path -LiteralPath $operator)) {
        throw "Local operator missing: $operator (packaged mining uses miner-start without local stack)"
    }
    if ($SkipExplorer -and $OperatorCommand -in @("start", "restart")) {
        & $operator $OperatorCommand -SkipExplorer
    } elseif ($OperatorCommand -eq "logs") {
        & $operator $OperatorCommand -Service $Service -Tail $Tail
    } else {
        & $operator $OperatorCommand
    }
    if (-not $?) {
        throw "Operator command '$OperatorCommand' failed."
    }
}

switch ($Command) {
    "miner-start" { Start-PackagedMiner }
    "miner-stop" { Stop-PackagedMiner }
    "status" {
        Write-Host "workspace: $workspace"
        Write-Host "rpc: $rpcUrl"
        try {
            $h = Invoke-RestMethod -Uri "$rpcUrl/status" -TimeoutSec 8
            Write-Host ("chain height: {0}" -f $h.height)
        } catch {
            Write-Host "rpc status failed: $($_.Exception.Message)"
        }
        $localRoot = Get-LocalRoot
        $pidFile = Join-Path $localRoot "logs\miner.pid"
        if (Test-Path -LiteralPath $pidFile) {
            Write-Host "miner pid: $((Get-Content $pidFile -Raw).Trim())"
        } else {
            Write-Host "miner: not running"
        }
    }
    "start" {
        if (Test-Path -LiteralPath $operator) { Invoke-Operator "start" } else { throw "Local stack not available in this install. Use miner-start against VPS." }
    }
    "stop" {
        Stop-PackagedMiner
        if (Test-Path -LiteralPath $operator) { Invoke-Operator "stop" }
    }
    "restart" {
        if (Test-Path -LiteralPath $operator) { Invoke-Operator "restart" } else { throw "Local stack not available." }
    }
    "mine" {
        if (Test-Path -LiteralPath $operator) { Invoke-Operator "mine" } else { throw "Local mine not available. Use miner-start." }
    }
    "validate" {
        if (Test-Path -LiteralPath $operator) { Invoke-Operator "status" } else { Write-Host "validate: use VPS node" }
    }
    "backup" {
        if (Test-Path -LiteralPath $operator) { Invoke-Operator "backup" } else { throw "backup not available in packaged remote mode" }
    }
    "logs" {
        $localRoot = Get-LocalRoot
        $log = Join-Path $localRoot "logs\$Service.log"
        if (Test-Path -LiteralPath $log) {
            Get-Content -LiteralPath $log -Tail $Tail
        } else {
            Write-Host "no log at $log"
        }
    }
    default { Show-Usage }
}

# Register vireon-browser-host for Chrome / Edge / Brave native messaging (Windows).
# Usage:
#   .\scripts\browser\register-native-host.ps1 -ExtensionId <id>
#   .\scripts\browser\register-native-host.ps1 -ExtensionId <id> -Build -Browser All
#   .\scripts\browser\register-native-host.ps1 -ExtensionId <id> -RequireOsConfirm

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionId,

    [ValidateSet("Chrome", "Edge", "Brave", "All")]
    [string]$Browser = "Chrome",

    [string]$HostBinary = "",

    [string]$InstallDir = "",

    [switch]$Build,

    [switch]$RequireOsConfirm,

    [switch]$LocalRpc
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $RepoRoot

if ($Build -or [string]::IsNullOrWhiteSpace($HostBinary)) {
    Write-Host "Building vireon-browser-host (release)..."
    cargo build -p vireon-browser-host --release
    $defaultBin = Join-Path $RepoRoot "target\release\vireon-browser-host.exe"
    if (-not (Test-Path $defaultBin)) {
        throw "Host binary not found at $defaultBin"
    }
    if ([string]::IsNullOrWhiteSpace($HostBinary)) {
        $HostBinary = $defaultBin
    }
}

$HostBinary = (Resolve-Path $HostBinary).Path
if (-not (Test-Path $HostBinary)) {
    throw "Host binary not found: $HostBinary"
}

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = Join-Path $env:LOCALAPPDATA "Vireon\browser-host"
}
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$InstalledBinary = Join-Path $InstallDir "vireon-browser-host.exe"
Copy-Item -Force -Path $HostBinary -Destination $InstalledBinary

# Optional launcher that injects flags for native messaging children.
$LauncherPath = Join-Path $InstallDir "vireon-browser-host-launcher.cmd"
$launcherArgs = @()
if ($RequireOsConfirm) { $launcherArgs += "--require-os-confirm" }
if ($LocalRpc) { $launcherArgs += "--local" }
$launcherArgLine = ($launcherArgs -join " ")
@"
@echo off
"$InstalledBinary" $launcherArgLine %*
"@ | Set-Content -Encoding ASCII -Path $LauncherPath

$HostName = "com.vireon.browser_host"
$ManifestPath = Join-Path $InstallDir "$HostName.json"
$Origin = "chrome-extension://$ExtensionId/"

$manifestObject = [ordered]@{
    name            = $HostName
    description     = "Vireon Network browser native messaging host (Mainnet Candidate)"
    path            = $LauncherPath
    type            = "stdio"
    allowed_origins = @($Origin)
}
$manifestObject | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -Path $ManifestPath

function Register-BrowserHost {
    param(
        [string]$BrowserName,
        [string]$RegistryPath
    )
    if (-not (Test-Path $RegistryPath)) {
        New-Item -Path $RegistryPath -Force | Out-Null
    }
    New-ItemProperty -Path $RegistryPath -Name "(default)" -Value $ManifestPath -PropertyType String -Force | Out-Null
    Write-Host "Registered $BrowserName -> $RegistryPath"
}

$targets = @()
switch ($Browser) {
    "Chrome" { $targets = @(@{ Name = "Chrome"; Path = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName" }) }
    "Edge" { $targets = @(@{ Name = "Edge"; Path = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName" }) }
    "Brave" { $targets = @(@{ Name = "Brave"; Path = "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$HostName" }) }
    "All" {
        $targets = @(
            @{ Name = "Chrome"; Path = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName" },
            @{ Name = "Edge"; Path = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName" },
            @{ Name = "Brave"; Path = "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$HostName" }
        )
    }
}

foreach ($t in $targets) {
    Register-BrowserHost -BrowserName $t.Name -RegistryPath $t.Path
}

Write-Host ""
Write-Host "Install complete (Mainnet Candidate scaffold)"
Write-Host "  Host binary : $InstalledBinary"
Write-Host "  Launcher    : $LauncherPath"
Write-Host "  Manifest    : $ManifestPath"
Write-Host "  Extension   : $Origin"
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Chrome/Edge -> Extensions -> Load unpacked -> vireon-browser/extension"
Write-Host "  2. Copy the extension ID into this script if it changed, then re-run."
Write-Host "  3. Open the popup and press Ping."
Write-Host ""
& $InstalledBinary --print-info

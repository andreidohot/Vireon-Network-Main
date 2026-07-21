$ErrorActionPreference = "Stop"

if ($args -contains "--help" -or $args -contains "-h" -or $args -contains "-Help") {
  Write-Host "Usage: scripts/security/check-repo-hygiene.ps1"
  Write-Host "Fails when tracked or unignored runtime data, build artifacts, logs, or generated folders can enter the repository."
  exit 0
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

$candidates = @()
$candidates += git ls-files
$candidates += git ls-files --others --exclude-standard
$candidates = $candidates | Where-Object { $_ } | ForEach-Object { $_ -replace '\\', '/' } | Sort-Object -Unique
$issues = New-Object System.Collections.Generic.List[string]

$forbiddenPatterns = @(
  '(^|/)\.(veiron|vireon)-(dev|testnet|mainnet|local)(/|$)',
  '(^|/)(target|target-msvc|node_modules|logs|devnet-data|node-data|\.artifacts|coverage)(/|$)',
  '(^|/)vireon-release/vps-control-plane/state/(?!config/generated/\.gitkeep$|secrets/\.gitkeep$).+',
  '(^|/)chain\.jsonl$',
  '\.(log|pid|tmp|bak|orig|rej|db|sqlite|exe|dll|msi|AppImage|deb|rpm|apk|aab)$'
)

foreach ($file in $candidates) {
  if ($file -match '^\.review/pipeline/(runs|worktrees)/' -and $file -ne '.review/pipeline/runs/.gitkeep') {
    $issues.Add("Forbidden local pipeline artifact: $file")
    continue
  }
  foreach ($pattern in $forbiddenPatterns) {
    if ($file -match $pattern) {
      $issues.Add("Forbidden tracked or unignored artifact: $file")
      break
    }
  }
}

if ($issues.Count -gt 0) {
  Write-Error ("Repository hygiene check failed:`n- " + ($issues -join "`n- "))
  exit 1
}

Write-Host "Repository hygiene check passed."

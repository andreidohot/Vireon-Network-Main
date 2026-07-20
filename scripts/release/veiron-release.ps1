[CmdletBinding()]
param(
    [string]$RepoPath = ".",
    [string]$ArtifactsPath = "",
    [ValidateRange(1, 720)][int]$RecentHours = 24
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
$script:ReleaseManagerVersion = "3.1.1"

function Write-Title {
    param([string]$Text)
    Write-Host ""
    Write-Host ("=" * 72) -ForegroundColor DarkCyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host ("=" * 72) -ForegroundColor DarkCyan
}

function Write-Info {
    param([string]$Text)
    Write-Host "[INFO] $Text" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Text)
    Write-Host "[OK]   $Text" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Text)
    Write-Host "[WARN] $Text" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Text)
    Write-Host "[ERR]  $Text" -ForegroundColor Red
}

function Test-Tool {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [string[]]$Arguments = @(),
        [switch]$Capture,
        [switch]$AllowFailure
    )

    if ($Capture) {
        $output = & $Command @Arguments 2>&1
        $exitCode = $LASTEXITCODE
        if (($exitCode -ne 0) -and (-not $AllowFailure)) {
            $message = ($output | Out-String).Trim()
            throw "Comanda a esuat: $Command $($Arguments -join ' ')`n$message"
        }
        return [pscustomobject]@{
            ExitCode = $exitCode
            Output   = (($output | Out-String).Trim())
        }
    }

    & $Command @Arguments
    $exitCode = $LASTEXITCODE
    if (($exitCode -ne 0) -and (-not $AllowFailure)) {
        throw "Comanda a esuat cu codul ${exitCode}: $Command $($Arguments -join ' ')"
    }

    return $exitCode
}

function Confirm-Action {
    param(
        [string]$Message,
        [bool]$DefaultYes = $false
    )

    $suffix = if ($DefaultYes) { "[D/n]" } else { "[d/N]" }
    while ($true) {
        $answer = (Read-Host "$Message $suffix").Trim().ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($answer)) {
            return $DefaultYes
        }
        if ($answer -in @("d", "da", "y", "yes")) {
            return $true
        }
        if ($answer -in @("n", "nu", "no")) {
            return $false
        }
        Write-Warn "Raspunde cu d/da sau n/nu."
    }
}

function Read-MenuChoice {
    param(
        [string]$Prompt,
        [string[]]$Allowed
    )

    while ($true) {
        $choice = (Read-Host $Prompt).Trim()
        if ($choice -in $Allowed) {
            return $choice
        }
        Write-Warn "Optiune invalida. Alege: $($Allowed -join ', ')."
    }
}

function Get-RepositoryRoot {
    param([string]$Path)

    $resolved = (Resolve-Path $Path).Path
    Push-Location $resolved
    try {
        $result = Invoke-Native -Command "git" -Arguments @("rev-parse", "--show-toplevel") -Capture
        return $result.Output
    }
    finally {
        Pop-Location
    }
}

function Get-CurrentBranch {
    $result = Invoke-Native -Command "git" -Arguments @("branch", "--show-current") -Capture
    return $result.Output.Trim()
}

function Get-DefaultBranch {
    if (Test-Tool "gh") {
        $result = Invoke-Native -Command "gh" -Arguments @("repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name") -Capture -AllowFailure
        if (($result.ExitCode -eq 0) -and (-not [string]::IsNullOrWhiteSpace($result.Output))) {
            return $result.Output.Trim()
        }
    }

    $symbolic = Invoke-Native -Command "git" -Arguments @("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD") -Capture -AllowFailure
    if (($symbolic.ExitCode -eq 0) -and ($symbolic.Output -match "^origin/(.+)$")) {
        return $Matches[1]
    }

    return "main"
}

function Test-GhReady {
    if (-not (Test-Tool "gh")) {
        Write-Warn "GitHub CLI (gh) nu este instalat. Tag-ul poate porni release-urile automat, dar relansarea individuala necesita gh."
        return $false
    }

    $auth = Invoke-Native -Command "gh" -Arguments @("auth", "status") -Capture -AllowFailure
    if ($auth.ExitCode -ne 0) {
        Write-Warn "GitHub CLI nu este autentificat. Ruleaza: gh auth login"
        return $false
    }

    return $true
}

function Test-SupportedReleaseArtifact {
    param([System.IO.FileInfo]$File)

    $name = $File.Name.ToLowerInvariant()
    if ($name -match "electron" -or $name -in @("latest.yml", "latest-linux.yml")) {
        return $false
    }

    if ($name.EndsWith(".tar.gz")) {
        return $true
    }

    return $File.Extension.ToLowerInvariant() -in @(
        ".exe", ".msi", ".zip", ".appimage", ".deb", ".rpm",
        ".gz", ".sha256", ".txt", ".json", ".sig", ".asc"
    )
}

function Get-RecentReleaseArtifacts {
    param(
        [string]$Path,
        [int]$Hours
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return @()
    }

    $cutoff = (Get-Date).AddHours(-$Hours)
    $files = Get-ChildItem -LiteralPath $Path -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object {
            $_.LastWriteTime -ge $cutoff -and (Test-SupportedReleaseArtifact -File $_)
        } |
        Sort-Object LastWriteTime -Descending

    # GitHub Release nu accepta doua fisiere cu acelasi nume. Pastreaza varianta cea mai recenta.
    $unique = @{}
    foreach ($file in $files) {
        $key = $file.Name.ToLowerInvariant()
        if (-not $unique.ContainsKey($key)) {
            $unique[$key] = $file
        }
    }

    return @($unique.Values | Sort-Object LastWriteTime -Descending)
}

function Format-FileSize {
    param([long]$Bytes)
    if ($Bytes -ge 1GB) { return ("{0:N2} GB" -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ("{0:N2} MB" -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ("{0:N2} KB" -f ($Bytes / 1KB)) }
    return "$Bytes B"
}

function Get-LocalArtifactPlatforms {
    param([System.IO.FileInfo[]]$Files)

    $platforms = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $Files) {
        $name = $file.Name.ToLowerInvariant()
        $extension = $file.Extension.ToLowerInvariant()

        if ($name -match "vps|control[-_ ]?plane|server[-_ ]?bundle" -or $name.EndsWith(".tar.gz")) {
            [void]$platforms.Add("vps")
            continue
        }

        if ($extension -in @(".appimage", ".deb", ".rpm") -or $name -match "linux|appimage") {
            [void]$platforms.Add("linux")
            continue
        }

        if ($extension -in @(".exe", ".msi") -or $name -match "windows|win64|win32|setup|installer|portable" -or $extension -eq ".zip") {
            [void]$platforms.Add("windows")
        }
    }

    return @($platforms | Sort-Object)
}

function Select-RecentLocalArtifacts {
    param(
        [string]$Path,
        [int]$DefaultHours
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        Write-Info "Folderul local de artefacte nu exista: $Path"
        return @()
    }

    $hours = $DefaultHours
    $enteredHours = (Read-Host "Caut artefacte modificate in ultimele cate ore? [$DefaultHours]").Trim()
    if (-not [string]::IsNullOrWhiteSpace($enteredHours)) {
        $parsedHours = 0
        if (-not [int]::TryParse($enteredHours, [ref]$parsedHours) -or $parsedHours -lt 1 -or $parsedHours -gt 720) {
            throw "Interval invalid. Introdu un numar intre 1 si 720 de ore."
        }
        $hours = $parsedHours
    }

    $files = @(Get-RecentReleaseArtifacts -Path $Path -Hours $hours)
    if ($files.Count -eq 0) {
        Write-Info "Nu am gasit artefacte eligibile modificate in ultimele $hours ore."
        return @()
    }

    Write-Host ""
    Write-Host "Artefacte locale recente gasite in:" -ForegroundColor White
    Write-Host "  $Path" -ForegroundColor DarkGray
    for ($i = 0; $i -lt $files.Count; $i++) {
        $file = $files[$i]
        Write-Host ("  {0,2}. {1} | {2} | {3}" -f ($i + 1), $file.Name, (Format-FileSize -Bytes $file.Length), $file.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
    }

    Write-Host ""
    Write-Host "  1. Urca toate artefactele de mai sus si NU reconstrui Windows/Linux/VPS"
    Write-Host "  2. Aleg manual fisierele"
    Write-Host "  0. Ignora artefactele locale si lasa GitHub Actions sa construiasca"
    $choice = Read-MenuChoice -Prompt "Alege sursa release-ului" -Allowed @("0", "1", "2")

    if ($choice -eq "0") {
        return @()
    }
    if ($choice -eq "1") {
        return $files
    }

    while ($true) {
        $selection = (Read-Host "Scrie numerele separate prin virgula, exemplu 1,2,5").Trim()
        $indexes = @()
        $valid = $true
        foreach ($part in ($selection -split ",")) {
            $number = 0
            if (-not [int]::TryParse($part.Trim(), [ref]$number) -or $number -lt 1 -or $number -gt $files.Count) {
                $valid = $false
                break
            }
            $indexes += ($number - 1)
        }
        if ($valid -and $indexes.Count -gt 0) {
            return @($indexes | Select-Object -Unique | ForEach-Object { $files[$_] })
        }
        Write-Warn "Selectie invalida."
    }
}

function Ensure-GitHubPrerelease {
    param([string]$Tag)

    $existing = Invoke-Native -Command "gh" -Arguments @("release", "view", $Tag) -Capture -AllowFailure
    if ($existing.ExitCode -eq 0) {
        return
    }

    $notesPath = Join-Path ([System.IO.Path]::GetTempPath()) ("veiron-release-notes-{0}.md" -f ([guid]::NewGuid().ToString("N")))
    @"
## Mainnet Candidate prerelease - not public Mainnet

Acest release poate contine artefacte construite local si verificate de operator. Windows, Linux si VPS sunt publicate independent. Verifica fisierul SHA256SUMS-LOCAL.txt inainte de testare.
"@ | Set-Content -LiteralPath $notesPath -Encoding UTF8

    try {
        $lastError = $null
        for ($attempt = 1; $attempt -le 5; $attempt++) {
            $create = Invoke-Native -Command "gh" -Arguments @(
                "release", "create", $Tag,
                "--verify-tag",
                "--title", "Veiron $Tag",
                "--notes-file", $notesPath,
                "--prerelease"
            ) -Capture -AllowFailure

            if ($create.ExitCode -eq 0) {
                return
            }

            $view = Invoke-Native -Command "gh" -Arguments @("release", "view", $Tag) -Capture -AllowFailure
            if ($view.ExitCode -eq 0) {
                return
            }

            $lastError = $create.Output
            Start-Sleep -Seconds 2
        }
        throw "Nu am putut crea prerelease-ul $Tag. $lastError"
    }
    finally {
        Remove-Item -LiteralPath $notesPath -Force -ErrorAction SilentlyContinue
    }
}

function Publish-LocalArtifactsToRelease {
    param(
        [string]$Tag,
        [System.IO.FileInfo[]]$Files
    )

    if ($Files.Count -eq 0) {
        return
    }

    Write-Title "Publica artefactele locale"
    Ensure-GitHubPrerelease -Tag $Tag

    $stage = Join-Path ([System.IO.Path]::GetTempPath()) ("veiron-local-release-{0}" -f ([guid]::NewGuid().ToString("N")))
    New-Item -ItemType Directory -Path $stage -Force | Out-Null

    try {
        $stagedFiles = @()
        foreach ($file in $Files) {
            $destination = Join-Path $stage $file.Name
            Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
            $stagedFiles += Get-Item -LiteralPath $destination
        }

        $checksumPath = Join-Path $stage "SHA256SUMS-LOCAL.txt"
        $checksumLines = foreach ($file in ($stagedFiles | Sort-Object Name)) {
            $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            "$hash  $($file.Name)"
        }
        $checksumLines | Set-Content -LiteralPath $checksumPath -Encoding ascii
        $stagedFiles += Get-Item -LiteralPath $checksumPath

        Write-Info "Urc $($stagedFiles.Count) fisiere in release-ul $Tag..."
        $arguments = @("release", "upload", $Tag)
        $arguments += @($stagedFiles | ForEach-Object { $_.FullName })
        $arguments += "--clobber"
        Invoke-Native -Command "gh" -Arguments $arguments | Out-Null

        Write-Ok "Artefactele locale au fost publicate in release-ul $Tag."
        foreach ($file in $stagedFiles) {
            Write-Host "  - $($file.Name)"
        }
    }
    finally {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Get-DesktopVersion {
    $packagePath = Join-Path (Get-Location) "veiron-desktop-tauri/package.json"
    if (Test-Path $packagePath) {
        try {
            $package = Get-Content -Raw -Path $packagePath | ConvertFrom-Json
            $version = [string]$package.version
            if ($version -match "^\d+\.\d+\.\d+(?:[-+].+)?$") {
                return ($version -replace "[-+].*$", "")
            }
        }
        catch {
            Write-Warn "Nu am putut citi versiunea din veiron-desktop-tauri/package.json."
        }
    }

    while ($true) {
        $version = (Read-Host "Versiunea de baza (exemplu 1.0.0)").Trim()
        $version = $version.TrimStart("v")
        if ($version -match "^\d+\.\d+\.\d+$") {
            return $version
        }
        Write-Warn "Versiunea trebuie sa aiba forma X.Y.Z, de exemplu 1.0.0."
    }
}

function Get-CandidateTags {
    param([string]$Version = "*")

    $pattern = if ($Version -eq "*") { "v*-candidate.*" } else { "v$Version-candidate.*" }
    $result = Invoke-Native -Command "git" -Arguments @("tag", "--list", $pattern, "--sort=-version:refname") -Capture
    if ([string]::IsNullOrWhiteSpace($result.Output)) {
        return @()
    }
    return @($result.Output -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-NextCandidateTag {
    param([string]$Version)

    $escapedVersion = [regex]::Escape($Version)
    $max = 0
    foreach ($existingTag in (Get-CandidateTags -Version $Version)) {
        if ($existingTag -match "^v${escapedVersion}-candidate\.(\d+)$") {
            $number = [int]$Matches[1]
            if ($number -gt $max) {
                $max = $number
            }
        }
    }

    return "v$Version-candidate.$($max + 1)"
}

function Test-TagExistsLocally {
    param([string]$Tag)
    $result = Invoke-Native -Command "git" -Arguments @("show-ref", "--verify", "--quiet", "refs/tags/$Tag") -Capture -AllowFailure
    return $result.ExitCode -eq 0
}

function Test-TagExistsRemotely {
    param([string]$Tag)
    $result = Invoke-Native -Command "git" -Arguments @("ls-remote", "--exit-code", "--tags", "origin", "refs/tags/$Tag") -Capture -AllowFailure
    return $result.ExitCode -eq 0
}

function Assert-ReleaseTagFormat {
    param([string]$Tag)
    if ($Tag -notmatch "^v\d+\.\d+\.\d+-candidate\.\d+$") {
        throw "Tag invalid: $Tag. Format acceptat: vX.Y.Z-candidate.N"
    }
}

function Sync-And-CheckRepository {
    Write-Info "Actualizez referintele si tag-urile de pe origin..."
    Invoke-Native -Command "git" -Arguments @("fetch", "origin", "--tags", "--prune") | Out-Null

    $branch = Get-CurrentBranch
    $head = (Invoke-Native -Command "git" -Arguments @("rev-parse", "--short", "HEAD") -Capture).Output
    if ([string]::IsNullOrWhiteSpace($branch)) {
        Write-Warn "Repository-ul este in detached HEAD la commit-ul $head."
        if (-not (Confirm-Action -Message "Continui si creez tag direct pe acest commit?" -DefaultYes $false)) {
            throw "Operatie anulata."
        }
    }
    else {
        Write-Info "Branch curent: $branch | commit: $head"
    }

    $status = (Invoke-Native -Command "git" -Arguments @("status", "--porcelain") -Capture).Output
    if (-not [string]::IsNullOrWhiteSpace($status)) {
        Write-Warn "Exista modificari necomise. Acestea NU vor intra in tag:"
        Write-Host $status
        if (-not (Confirm-Action -Message "Continui folosind doar ultimul commit (HEAD)?" -DefaultYes $false)) {
            throw "Fa commit la modificari, apoi ruleaza din nou scriptul."
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($branch)) {
        $upstream = Invoke-Native -Command "git" -Arguments @("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}") -Capture -AllowFailure
        if ($upstream.ExitCode -ne 0) {
            Write-Warn "Branch-ul $branch nu are upstream configurat."
            if (Confirm-Action -Message "Il public acum pe origin/$($branch)?" -DefaultYes $true) {
                Invoke-Native -Command "git" -Arguments @("push", "-u", "origin", $branch) | Out-Null
                Write-Ok "Branch publicat pe origin/$branch."
            }
            else {
                throw "Tag-ul nu este creat pana cand branch-ul nu este publicat."
            }
        }
        else {
            $upstreamName = $upstream.Output.Trim()
            $counts = (Invoke-Native -Command "git" -Arguments @("rev-list", "--left-right", "--count", "$upstreamName...HEAD") -Capture).Output.Trim()
            $parts = $counts -split "\s+"
            $behind = [int]$parts[0]
            $ahead = [int]$parts[1]

            if ($behind -gt 0) {
                throw "Branch-ul local este in urma cu $behind commit(uri) fata de $upstreamName. Fa pull/rebase inainte de release."
            }

            if ($ahead -gt 0) {
                Write-Warn "Branch-ul local are $ahead commit(uri) nepublicate."
                if (Confirm-Action -Message "Le public acum in $($upstreamName)?" -DefaultYes $true) {
                    Invoke-Native -Command "git" -Arguments @("push") | Out-Null
                    Write-Ok "Commit-urile au fost publicate."
                }
                else {
                    throw "Tag-ul nu este creat peste commit-uri nepublicate."
                }
            }
        }
    }

    return $branch
}

function Create-And-PushCandidateTag {
    param([switch]$Custom)

    $tag = $null
    $branch = $null
    $version = $null

    Write-Title "Creeaza candidate tag si porneste release-urile"
    $branch = Sync-And-CheckRepository
    $version = Get-DesktopVersion

    if ($Custom) {
        $defaultTag = Get-NextCandidateTag -Version $version
        $entered = (Read-Host "Tag-ul dorit [$defaultTag]").Trim()
        $tag = if ([string]::IsNullOrWhiteSpace($entered)) { $defaultTag } else { $entered }
    }
    else {
        $tag = Get-NextCandidateTag -Version $version
    }

    if ([string]::IsNullOrWhiteSpace([string]$tag)) {
        throw "Nu am putut genera tag-ul candidate. Verifica versiunea aplicatiei si incearca din nou."
    }

    Assert-ReleaseTagFormat -Tag $tag

    $expectedPrefix = "v$version-candidate."
    if (-not $tag.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Tag-ul $tag nu corespunde versiunii desktop $version. Workflow-urile il vor respinge."
    }

    if ((Test-TagExistsLocally -Tag $tag) -or (Test-TagExistsRemotely -Tag $tag)) {
        throw "Tag-ul $tag exista deja. Foloseste optiunea de relansare sau upload pentru un tag existent."
    }

    $localFiles = @()
    $ghReady = Test-GhReady
    if ($ghReady) {
        $localFiles = @(Select-RecentLocalArtifacts -Path $script:ResolvedArtifactsPath -DefaultHours $RecentHours)
    }

    $useLocalArtifacts = $localFiles.Count -gt 0
    $localPlatforms = @(Get-LocalArtifactPlatforms -Files $localFiles)
    $commit = (Invoke-Native -Command "git" -Arguments @("rev-parse", "--short", "HEAD") -Capture).Output.Trim()
    Write-Host ""
    Write-Host "Rezumat release:" -ForegroundColor White
    Write-Host "  Tag:       $tag"
    Write-Host "  Versiune:  $version"
    Write-Host "  Branch:    $(if ([string]::IsNullOrWhiteSpace($branch)) { 'detached HEAD' } else { $branch })"
    Write-Host "  Commit:    $commit"
    if ($useLocalArtifacts) {
        Write-Host "  Sursa:     $($localFiles.Count) artefact(e) locale recente"
        if ($localPlatforms.Count -gt 0) {
            Write-Host "  Local:     $($localPlatforms -join ', ')"
            Write-Host "  Actions:   platformele locale sunt sarite; platformele lipsa si Quality continua"
        }
        else {
            Write-Host "  Actions:   artefactele neclasificate se urca, dar build-urile continua"
        }
    }
    else {
        Write-Host "  Sursa:     GitHub Actions"
        Write-Host "  Porneste:  Windows + Linux + VPS + Quality (independent)"
    }
    Write-Host ""

    if (-not (Confirm-Action -Message "Creez si public tag-ul $($tag)?" -DefaultYes $false)) {
        Write-Warn "Operatie anulata."
        return
    }

    $tagMessage = "Veiron candidate release $tag"
    if ($useLocalArtifacts) {
        foreach ($platform in $localPlatforms) {
            $tagMessage += "`n[local-$platform]"
        }
    }

    Invoke-Native -Command "git" -Arguments @("tag", "-a", $tag, "-m", $tagMessage) | Out-Null
    try {
        Invoke-Native -Command "git" -Arguments @("push", "origin", $tag) | Out-Null
    }
    catch {
        Write-Fail "Tag-ul a fost creat local, dar publicarea pe GitHub a esuat."
        Write-Host "Poti reincerca manual cu: git push origin $tag"
        throw
    }

    Write-Ok "Tag publicat: $tag"

    if ($useLocalArtifacts) {
        Publish-LocalArtifactsToRelease -Tag $tag -Files $localFiles
        if ($localPlatforms.Count -gt 0) {
            Write-Ok "Nu se reconstruiesc platformele locale: $($localPlatforms -join ', ')."
        }
        else {
            Write-Warn "Fisierele au fost urcate, dar nu au putut fi asociate unei platforme; build-urile continua."
        }
    }
    else {
        Write-Ok "GitHub Actions a primit evenimentul. Cele patru workflow-uri ruleaza independent."
        Write-Host ""
        Write-Host "Important: nu trebuie sa creezi manual release-ul." -ForegroundColor Yellow
        Write-Host "Primul workflow de platforma care termina cu succes creeaza prerelease-ul, iar celelalte adauga propriile fisiere."
    }

    if ($ghReady) {
        $repoUrl = (Invoke-Native -Command "gh" -Arguments @("repo", "view", "--json", "url", "--jq", ".url") -Capture).Output.Trim()
        if (-not [string]::IsNullOrWhiteSpace($repoUrl)) {
            Write-Host "Actions:  $repoUrl/actions"
            Write-Host "Releases: $repoUrl/releases/tag/$tag"
            if (Confirm-Action -Message "Deschid release-ul in browser?" -DefaultYes $true) {
                Start-Process "$repoUrl/releases/tag/$tag"
            }
        }
    }
}

function Select-ExistingTag {
    $tags = @(Get-CandidateTags)
    if ($tags.Count -eq 0) {
        throw "Nu exista candidate tags locale. Ruleaza git fetch origin --tags sau creeaza primul tag."
    }

    Write-Host ""
    Write-Host "Candidate tags recente:" -ForegroundColor White
    $limit = [Math]::Min($tags.Count, 15)
    for ($i = 0; $i -lt $limit; $i++) {
        Write-Host ("  {0,2}. {1}" -f ($i + 1), $tags[$i])
    }

    $entered = (Read-Host "Alege numarul sau scrie tag-ul complet [1]").Trim()
    if ([string]::IsNullOrWhiteSpace($entered)) {
        return $tags[0]
    }

    $number = 0
    if ([int]::TryParse($entered, [ref]$number)) {
        if (($number -lt 1) -or ($number -gt $limit)) {
            throw "Numar invalid."
        }
        return $tags[$number - 1]
    }

    Assert-ReleaseTagFormat -Tag $entered
    return $entered
}

function Start-WorkflowForTag {
    param(
        [string]$Workflow,
        [string]$Tag,
        [string]$DefaultBranch
    )

    Write-Info "Pornesc $Workflow pentru $Tag..."
    $arguments = @("workflow", "run", $Workflow, "--ref", $DefaultBranch, "-f", "tag=$Tag")
    if ($Workflow -in @("candidate-windows-release.yml", "candidate-linux-release.yml", "candidate-vps-release.yml")) {
        $arguments += @("-f", "force_build=true")
    }
    Invoke-Native -Command "gh" -Arguments $arguments | Out-Null
    Write-Ok "Pornit: $Workflow"
}

function Restart-IndependentWorkflows {
    $tag = $null
    $defaultBranch = $null

    Write-Title "Relanseaza un release independent"

    Invoke-Native -Command "git" -Arguments @("fetch", "origin", "--tags", "--prune") | Out-Null
    if (-not (Test-GhReady)) {
        throw "Pentru relansare manuala instaleaza GitHub CLI si ruleaza gh auth login."
    }

    $tag = [string](Select-ExistingTag)
    if ([string]::IsNullOrWhiteSpace($tag)) {
        throw "Nu a fost selectat niciun tag."
    }
    if (-not (Test-TagExistsRemotely -Tag $tag)) {
        throw "Tag-ul $tag nu exista pe origin."
    }

    $defaultBranch = Get-DefaultBranch
    Write-Info "Workflow-urile vor fi lansate din branch-ul implicit: $defaultBranch"

    Write-Host ""
    Write-Host "  1. Windows"
    Write-Host "  2. Linux"
    Write-Host "  3. VPS"
    Write-Host "  4. Quality checks"
    Write-Host "  5. Toate cele patru"
    Write-Host "  0. Inapoi"
    $choice = Read-MenuChoice -Prompt "Alege workflow-ul" -Allowed @("0", "1", "2", "3", "4", "5")
    if ($choice -eq "0") {
        return
    }

    $workflows = @()
    switch ($choice) {
        "1" { $workflows = @("candidate-windows-release.yml") }
        "2" { $workflows = @("candidate-linux-release.yml") }
        "3" { $workflows = @("candidate-vps-release.yml") }
        "4" { $workflows = @("candidate-quality.yml") }
        "5" {
            $workflows = @(
                "candidate-windows-release.yml",
                "candidate-linux-release.yml",
                "candidate-vps-release.yml",
                "candidate-quality.yml"
            )
        }
    }

    Write-Host ""
    Write-Host "Tag: $tag"
    Write-Host "Workflow-uri: $($workflows -join ', ')"
    if (-not (Confirm-Action -Message "Pornesc workflow-urile selectate?" -DefaultYes $false)) {
        Write-Warn "Operatie anulata."
        return
    }

    foreach ($workflow in $workflows) {
        Start-WorkflowForTag -Workflow $workflow -Tag $tag -DefaultBranch $defaultBranch
    }

    $repoUrl = (Invoke-Native -Command "gh" -Arguments @("repo", "view", "--json", "url", "--jq", ".url") -Capture).Output.Trim()
    Write-Host "Actions: $repoUrl/actions"
    if (Confirm-Action -Message "Deschid GitHub Actions in browser?" -DefaultYes $true) {
        Start-Process "$repoUrl/actions"
    }
}

function Upload-LocalArtifactsForExistingTag {
    $tag = $null

    Write-Title "Urca artefacte locale intr-un tag existent"

    Invoke-Native -Command "git" -Arguments @("fetch", "origin", "--tags", "--prune") | Out-Null
    if (-not (Test-GhReady)) {
        throw "Pentru upload local instaleaza GitHub CLI si ruleaza gh auth login."
    }

    $tag = [string](Select-ExistingTag)
    if ([string]::IsNullOrWhiteSpace($tag)) {
        throw "Nu a fost selectat niciun tag."
    }
    if (-not (Test-TagExistsRemotely -Tag $tag)) {
        throw "Tag-ul $tag nu exista pe origin."
    }

    $files = @(Select-RecentLocalArtifacts -Path $script:ResolvedArtifactsPath -DefaultHours $RecentHours)
    if ($files.Count -eq 0) {
        Write-Warn "Nu ai selectat niciun artefact."
        return
    }

    Write-Host ""
    Write-Host "Tag: $tag"
    Write-Host "Fisiere: $($files.Count)"
    if (-not (Confirm-Action -Message "Urc fisierele selectate si inlocuiesc duplicatele dupa nume?" -DefaultYes $false)) {
        Write-Warn "Operatie anulata."
        return
    }

    Publish-LocalArtifactsToRelease -Tag $tag -Files $files
}

function Show-CandidateTags {
    Write-Title "Candidate tags"
    Invoke-Native -Command "git" -Arguments @("fetch", "origin", "--tags", "--prune") | Out-Null
    $tags = @(Get-CandidateTags)
    if ($tags.Count -eq 0) {
        Write-Warn "Nu exista candidate tags."
        return
    }
    foreach ($candidateTag in $tags) {
        Write-Host "  $candidateTag"
    }
}

function Open-GitHubPages {
    Write-Title "Deschide GitHub"
    if (-not (Test-GhReady)) {
        throw "Instaleaza GitHub CLI si ruleaza gh auth login."
    }

    $repoUrl = (Invoke-Native -Command "gh" -Arguments @("repo", "view", "--json", "url", "--jq", ".url") -Capture).Output.Trim()
    Write-Host "  1. Actions"
    Write-Host "  2. Releases"
    Write-Host "  0. Inapoi"
    $choice = Read-MenuChoice -Prompt "Alege pagina" -Allowed @("0", "1", "2")
    switch ($choice) {
        "1" { Start-Process "$repoUrl/actions" }
        "2" { Start-Process "$repoUrl/releases" }
    }
}

if (-not (Test-Tool "git")) {
    throw "Git nu este instalat sau nu este in PATH."
}

$repoRoot = Get-RepositoryRoot -Path $RepoPath
Set-Location $repoRoot

if ([string]::IsNullOrWhiteSpace($ArtifactsPath)) {
    $script:ResolvedArtifactsPath = Join-Path $repoRoot "release-artifacts"
}
elseif ([System.IO.Path]::IsPathRooted($ArtifactsPath)) {
    $script:ResolvedArtifactsPath = $ArtifactsPath
}
else {
    $script:ResolvedArtifactsPath = Join-Path $repoRoot $ArtifactsPath
}

Write-Title "Veiron Independent Release Manager v$script:ReleaseManagerVersion"
Write-Ok "Repository: $repoRoot"
Write-Info "Artefacte locale: $script:ResolvedArtifactsPath"

while ($true) {
    Write-Host ""
    Write-Host "  1. Creeaza urmatorul candidate tag si porneste toate release-urile"
    Write-Host "  2. Creeaza un candidate tag personalizat"
    Write-Host "  3. Relanseaza Windows/Linux/VPS/Quality pentru un tag existent"
    Write-Host "  4. Urca artefacte locale intr-un tag existent"
    Write-Host "  5. Afiseaza candidate tags"
    Write-Host "  6. Deschide GitHub Actions sau Releases"
    Write-Host "  0. Iesire"
    Write-Host ""

    $choice = Read-MenuChoice -Prompt "Alege optiunea" -Allowed @("0", "1", "2", "3", "4", "5", "6")
    try {
        switch ($choice) {
            "0" {
                Write-Host "La revedere."
                exit 0
            }
            "1" { Create-And-PushCandidateTag }
            "2" { Create-And-PushCandidateTag -Custom }
            "3" { Restart-IndependentWorkflows }
            "4" { Upload-LocalArtifactsForExistingTag }
            "5" { Show-CandidateTags }
            "6" { Open-GitHubPages }
        }
    }
    catch {
        $currentError = $_
        Write-Fail $currentError.Exception.Message
        if ($null -ne $currentError.InvocationInfo -and $currentError.InvocationInfo.ScriptLineNumber -gt 0) {
            Write-Host ("[DEBUG] Fisier: {0}" -f $currentError.InvocationInfo.ScriptName) -ForegroundColor DarkGray
            Write-Host ("[DEBUG] Linia:  {0}" -f $currentError.InvocationInfo.ScriptLineNumber) -ForegroundColor DarkGray
            if (-not [string]::IsNullOrWhiteSpace($currentError.InvocationInfo.Line)) {
                Write-Host ("[DEBUG] Cod:    {0}" -f $currentError.InvocationInfo.Line.Trim()) -ForegroundColor DarkGray
            }
        }
    }
}

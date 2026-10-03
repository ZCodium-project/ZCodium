# docx Environment Setup & Initialization Script (Windows PowerShell)
# Mirror of setup.sh — Windows 10/11 + Windows Server 2019+
# Requires: PowerShell 5.1+ (Windows-shipped) or PowerShell 7+ (pwsh)
# Goals (parity with setup.sh):
#   - dotnet >= 9
#   - python (3.x), pandoc, LibreOffice (soffice.exe), poppler (pdftoppm.exe), zip/unzip
#   - UTF-8 console (CRITICAL: dotnet build of the bundled project will fail on GBK consoles
#     because some C# samples carry CJK content)
#   - Same [OK] / [WARN] / [FAIL] / [INFO] / === === lines as setup.sh
#   - Same exit codes (0 success / 1 fatal / 2 unsupported shell)
#Requires -Version 5.1

[CmdletBinding()]
param(
    [ValidateSet('Read', 'Render', 'Full')]
    [string]$Level = 'Full',
    [switch]$Minimal,
    [switch]$SkipVerify,
    [switch]$Help
)

$ErrorActionPreference = "Stop"
# Force UTF-8 for THIS session AND its child native processes (dotnet build / pandoc / soffice).
# [Console]::OutputEncoding only affects PowerShell's view of stdout. The active console code page
# (chcp) is what child native processes inherit, and CN/JP/KR Windows ships with chcp 936/932/949.
# Bundled C# Sample files contain CJK string literals WITHOUT a UTF-8 BOM, so `dotnet build` will
# fail on a non-UTF-8 console code page. chcp must come BEFORE the [Console]::OutputEncoding
# assignment so we don't double-flip the encoding.
try { & chcp.com 65001 *> $null } catch { } # chcp.com missing on Nano Server / WSL pwsh — fall through
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.UTF8Encoding]::new()
# PS 5.1 default Invoke-WebRequest only enables Ssl3 + Tls1.0; dotnet-install endpoint requires
# TLS 1.2+ since 2020. Enable Tls12/Tls13 globally for this session before any IWR call.
try {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor `
        [Net.SecurityProtocolType]::Tls12 -bor `
        [Net.SecurityProtocolType]::Tls11
    if ([enum]::GetNames([Net.SecurityProtocolType]) -contains 'Tls13') {
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.ServicePointManager]::SecurityProtocol -bor `
            [Net.SecurityProtocolType]::Tls13
    }
} catch { } # rare environments lack the enum; let IWR fail loudly later
$env:DOTNET_CLI_UI_LANGUAGE = 'en'

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$DotnetDir  = Join-Path $ScriptDir 'dotnet'
$LogFile    = Join-Path $ProjectDir '.setup.log'
$DotnetRequiredMajor = 9

# --- Output helpers (parity with setup.sh log/warn/fail/info/step) ---
function Write-Log   { param([Parameter(ValueFromRemainingArguments = $true)]$Msg) Write-Host ("[OK]    " + ($Msg -join ' ')) -ForegroundColor Green }
function Write-Warn  { param([Parameter(ValueFromRemainingArguments = $true)]$Msg) Write-Host ("[WARN]  " + ($Msg -join ' ')) -ForegroundColor Yellow }
function Write-Fail  { param([Parameter(ValueFromRemainingArguments = $true)]$Msg) Write-Host ("[FAIL]  " + ($Msg -join ' ')) -ForegroundColor Red }
function Write-Info  { param([Parameter(ValueFromRemainingArguments = $true)]$Msg) Write-Host ("[INFO]  " + ($Msg -join ' ')) -ForegroundColor Cyan }
function Write-Step  { param([Parameter(ValueFromRemainingArguments = $true)]$Msg) Write-Host ("`n=== " + ($Msg -join ' ') + " ===") -ForegroundColor Blue }

if ($Help) {
    @"
Usage: setup.ps1 [-Level Read|Render|Full] [-Minimal] [-SkipVerify] [-Help]

  -Level Read     Only install/verify the read gate (python, unzip/tar, UTF-8)
  -Level Render   Above + soffice + pdftoppm
  -Level Full     Above + dotnet >= $DotnetRequiredMajor + pandoc + zip + project build (default)
  -Minimal        Skip optional checks (fonts only)
  -SkipVerify     Skip the final create-document verification
  -Help           Show this help
"@ | Write-Host
    exit 0
}

Write-Host "============================================"
Write-Host "  docx Setup & Initialization (Windows)"
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "  Level: $Level"
Write-Host "============================================"

"" | Set-Content -Path $LogFile -Encoding UTF8

# --- Detect package manager ---
function Test-Command($Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }
$HasWinget = Test-Command winget
$HasChoco  = Test-Command choco
$HasScoop  = Test-Command scoop

if     ($HasWinget) { Write-Info "Package manager: winget" }
elseif ($HasChoco)  { Write-Info "Package manager: chocolatey" }
elseif ($HasScoop)  { Write-Info "Package manager: scoop" }
else                { Write-Warn "No package manager found (winget/choco/scoop). Manual install may be needed." }

function Add-PathForSession([string]$Dir) {
    if (-not $Dir -or -not (Test-Path $Dir)) { return }
    if (-not (($env:Path -split [IO.Path]::PathSeparator) -contains $Dir)) {
        $env:Path = $Dir + [IO.Path]::PathSeparator + $env:Path
    }
}

# Pull whatever Machine/User PATH the registry currently holds, MERGE it with the existing
# session PATH (so any session-only Add-PathForSession entries from earlier in this script are
# preserved), and dedup. Naively re-assigning $env:Path = "$machine;$user" wipes session-only
# entries that have not been written to the registry yet — that was the original bug.
function Sync-PathFromMachineUser {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $sep     = [IO.Path]::PathSeparator
    $sessionExtras = @()
    foreach ($entry in ($env:Path -split $sep)) {
        if (-not $entry) { continue }
        $inMachine = ($machine -and ($machine -split $sep) -contains $entry)
        $inUser    = ($user    -and ($user    -split $sep) -contains $entry)
        if (-not ($inMachine -or $inUser)) { $sessionExtras += $entry }
    }
    $merged = @()
    foreach ($entry in @($sessionExtras + ($machine -split $sep) + ($user -split $sep))) {
        if (-not $entry) { continue }
        if ($merged -notcontains $entry) { $merged += $entry }
    }
    $env:Path = ($merged -join $sep)
}

# Back-compat alias for any external doc that still mentions the old name; new code MUST use
# Sync-PathFromMachineUser. The ordering bug was: callers did Add-PathForSession then Refresh,
# and Refresh wiped the just-added entry. Sync-* preserves session-only entries.
Set-Alias -Name Refresh-PathFromMachineUser -Value Sync-PathFromMachineUser

# Replacement for `Tee-Object -FilePath $LogFile -Append` whose default encoding in PS 5.1 is
# ANSI/Default (mojibakes CJK in the install log). Add-Content -Encoding UTF8 is the only
# reliable way on 5.1 to append UTF-8 without reopening/rewriting the file.
function Append-LogUtf8 {
    [CmdletBinding()]
    param([Parameter(ValueFromPipeline = $true)] $InputObject)
    process {
        $line = if ($null -eq $InputObject) { '' } else { "$InputObject" }
        Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8
        # Re-emit so the original Tee-Object behavior (also write to console / downstream) holds.
        $InputObject
    }
}

function Install-WithPkgMgr {
    param(
        [Parameter(Mandatory)] [string]$Tool,
        [string]$WingetId,
        [string]$ChocoId,
        [string]$ScoopId,
        [string]$ManualUrl
    )
    Write-Info "Installing $Tool ..."
    if     ($HasWinget -and $WingetId) {
        & winget install --id $WingetId --silent --accept-source-agreements --accept-package-agreements 2>&1 | Append-LogUtf8
    }
    elseif ($HasChoco -and $ChocoId) {
        & choco install $ChocoId -y --no-progress 2>&1 | Append-LogUtf8
    }
    elseif ($HasScoop -and $ScoopId) {
        & scoop install $ScoopId 2>&1 | Append-LogUtf8
    }
    else {
        Write-Fail "Cannot auto-install $Tool. Install it manually: $ManualUrl"
        return $false
    }
    Refresh-PathFromMachineUser
    return $true
}

# --- Resolve soffice.exe across the usual install layouts ---
function Resolve-SofficePath {
    $cmd = Get-Command soffice.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $cmd = Get-Command soffice -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        (Join-Path $env:ProgramFiles 'LibreOffice\program\soffice.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'LibreOffice\program\soffice.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\LibreOffice\program\soffice.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\soffice.exe'),
        (Join-Path $env:USERPROFILE  'scoop\apps\libreoffice\current\program\soffice.exe')
    ) | Where-Object { $_ }

    foreach ($p in $candidates) {
        if (Test-Path $p) { return (Resolve-Path $p).Path }
    }
    return $null
}

# --- Resolve pdftoppm.exe (poppler) ---
function Resolve-PdftoppmPath {
    $cmd = Get-Command pdftoppm.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $cmd = Get-Command pdftoppm -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        (Join-Path $env:USERPROFILE 'scoop\apps\poppler\current\bin\pdftoppm.exe'),
        (Join-Path $env:ProgramData 'chocolatey\bin\pdftoppm.exe')
    ) | Where-Object { $_ }
    foreach ($p in $candidates) { if (Test-Path $p) { return (Resolve-Path $p).Path } }
    return $null
}

# --- Resolve python (Windows ships `py` launcher; we want `python` callable) ---
function Resolve-PythonCommand {
    foreach ($name in @('python', 'python3', 'py')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        if ($name -eq 'py') {
            try {
                & $cmd.Source -3 --version *> $null
                if ($LASTEXITCODE -eq 0) { return @{ Cmd = $cmd.Source; Args = @('-3') } }
            } catch { continue }
        } else {
            return @{ Cmd = $cmd.Source; Args = @() }
        }
    }
    return $null
}

# ============ READ-LEVEL DEPS ============
function Install-Python {
    Write-Step "Checking python (>= 3.9)"
    $py = Resolve-PythonCommand
    if ($py) {
        $verLine = (& $py.Cmd @($py.Args + '--version') 2>&1) -join ' '
        Write-Log "python available: $($py.Cmd) ($verLine)"
        return $true
    }
    if (-not (Install-WithPkgMgr -Tool 'python' `
              -WingetId 'Python.Python.3.12' `
              -ChocoId  'python' `
              -ScoopId  'python' `
              -ManualUrl 'https://www.python.org/downloads/windows/')) { return $false }
    $py = Resolve-PythonCommand
    if (-not $py) { Write-Fail 'python installation finished but the command is still not on PATH'; return $false }
    Write-Log "python installed: $($py.Cmd)"
    return $true
}

function Install-UnzipFallback {
    Write-Step "Checking unzip / tar.exe"
    if (Test-Command tar) {
        # tar.exe ships with Windows 10 1803+ and handles .zip natively.
        Write-Log "tar.exe available (handles .zip on Windows 10+)"
        return $true
    }
    if (Test-Command unzip) {
        Write-Log "unzip available"
        return $true
    }
    Write-Warn "Neither tar.exe nor unzip found. Falling back to PowerShell Expand-Archive at runtime."
    Write-Info "(Expand-Archive ships with PowerShell 5+ so this is a soft warning, not a fatal.)"
    return $true
}

function Test-Utf8Console {
    Write-Step "Checking console encoding"
    $enc = [Console]::OutputEncoding.WebName
    $cp  = (chcp.com 2>$null | Out-String).Trim()
    if ($enc -match '^utf-?8$') {
        Write-Log "Console encoding: $enc / $cp"
        return $true
    }
    Write-Warn "Console encoding is $enc / $cp. Forcing UTF-8 for this session."
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Info "To make this permanent: 'Settings -> Time & Language -> Language & region -> Administrative -> Change system locale -> Beta: UTF-8'"
    return $true
}

function Set-ScriptUnblock {
    Write-Step "Unblocking skill scripts (NTFS Mark-of-the-Web)"
    Get-ChildItem -Path $ScriptDir -File -Include *.ps1, *.sh -Recurse -ErrorAction SilentlyContinue |
        ForEach-Object {
            try { Unblock-File -Path $_.FullName -ErrorAction Stop } catch { }
        }
    Write-Log "scripts unblocked (where applicable)"
}

# ============ RENDER-LEVEL DEPS ============
function Install-Soffice {
    Write-Step "Checking LibreOffice/soffice.exe"
    $sof = Resolve-SofficePath
    if ($sof) {
        Write-Log "soffice available: $sof"
        Add-PathForSession (Split-Path -Parent $sof)
        return $true
    }
    Write-Info "Installing LibreOffice (this may take a few minutes)..."
    if (-not (Install-WithPkgMgr -Tool 'LibreOffice' `
              -WingetId 'TheDocumentFoundation.LibreOffice' `
              -ChocoId  'libreoffice-fresh' `
              -ScoopId  'libreoffice' `
              -ManualUrl 'https://www.libreoffice.org/download/')) { return $false }
    $sof = Resolve-SofficePath
    if (-not $sof) {
        Write-Fail "LibreOffice install reported success but soffice.exe is still not discoverable. Add its 'program' directory to PATH and re-run."
        return $false
    }
    Add-PathForSession (Split-Path -Parent $sof)
    Write-Log "soffice installed: $sof"
    return $true
}

function Install-Poppler {
    Write-Step "Checking pdftoppm (poppler)"
    $pp = Resolve-PdftoppmPath
    if ($pp) { Write-Log "pdftoppm available: $pp"; return $true }
    if (-not (Install-WithPkgMgr -Tool 'poppler' `
              -WingetId 'oschwartz10612.Poppler' `
              -ChocoId  'poppler' `
              -ScoopId  'poppler' `
              -ManualUrl 'https://github.com/oschwartz10612/poppler-windows/releases')) { return $false }
    $pp = Resolve-PdftoppmPath
    if (-not $pp) { Write-Fail "poppler install reported success but pdftoppm.exe is still not discoverable"; return $false }
    Add-PathForSession (Split-Path -Parent $pp)
    Write-Log "pdftoppm installed: $pp"
    return $true
}

# ============ FULL-LEVEL DEPS ============
function Install-DotnetSdk {
    Write-Step "Checking .NET SDK (>= $DotnetRequiredMajor.0)"
    if (Test-Command dotnet) {
        $verRaw = (& dotnet --version) 2>$null
        if ($verRaw) {
            try {
                $major = [int](($verRaw -split '\.')[0])
                if ($major -ge $DotnetRequiredMajor) {
                    Write-Log "dotnet $verRaw already installed (>= $DotnetRequiredMajor.0 OK)"
                    return $true
                }
                Write-Warn "dotnet $verRaw found but < $DotnetRequiredMajor.0, upgrading..."
            } catch { Write-Warn "Could not parse dotnet --version output ('$verRaw'), reinstalling" }
        }
    }
    # Prefer the official Channel install via dotnet-install.ps1 (no admin, lands in $env:USERPROFILE\.dotnet)
    Write-Info "Installing .NET SDK $DotnetRequiredMajor via dotnet-install.ps1 (user-scope, no sudo)..."
    $installerPath = Join-Path $env:TEMP "dotnet-install.ps1"
    try {
        Invoke-WebRequest -Uri 'https://dot.net/v1/dotnet-install.ps1' -OutFile $installerPath -UseBasicParsing
    } catch {
        Write-Warn "Could not download dotnet-install.ps1: $_"
        if (-not (Install-WithPkgMgr -Tool '.NET SDK' `
                  -WingetId "Microsoft.DotNet.SDK.$DotnetRequiredMajor" `
                  -ChocoId  'dotnet-sdk' `
                  -ScoopId  'dotnet-sdk' `
                  -ManualUrl "https://dotnet.microsoft.com/download/dotnet/$DotnetRequiredMajor.0")) { return $false }
    }
    if (Test-Path $installerPath) {
        $dotnetRoot = Join-Path $env:USERPROFILE '.dotnet'
        & powershell -ExecutionPolicy Bypass -File $installerPath -Channel "$DotnetRequiredMajor.0" -InstallDir $dotnetRoot 2>&1 |
            Append-LogUtf8 | Out-Null
        # NOTE: do NOT Sync-PathFromMachineUser here. dotnet-install.ps1 (user-scope) installs to
        # $USERPROFILE\.dotnet but does NOT modify the registry PATH; syncing would still preserve
        # the session-only Add we're about to do, but no useful work would happen. Just Add and
        # move on.
        Add-PathForSession $dotnetRoot
    }
    if (-not (Test-Command dotnet)) {
        Write-Fail "dotnet installation failed"
        return $false
    }
    Write-Log "dotnet $(& dotnet --version) installed"
    return $true
}

function Install-Pandoc {
    Write-Step "Checking pandoc"
    if (Test-Command pandoc) {
        $pv = (& pandoc --version | Select-Object -First 1)
        Write-Log "pandoc already installed ($pv)"
        return $true
    }
    if (-not (Install-WithPkgMgr -Tool 'pandoc' `
              -WingetId 'JohnMacFarlane.Pandoc' `
              -ChocoId  'pandoc' `
              -ScoopId  'pandoc' `
              -ManualUrl 'https://pandoc.org/installing.html')) { return $false }
    if (-not (Test-Command pandoc)) { Write-Fail 'pandoc installation failed'; return $false }
    Write-Log "pandoc installed"
    return $true
}

function Install-ZipTools {
    Write-Step "Checking zip / Compress-Archive"
    if (Test-Command zip) { Write-Log "zip available"; return $true }
    # Compress-Archive is built into PowerShell 5+; treat as zip equivalent for skill needs.
    if (Get-Command Compress-Archive -ErrorAction SilentlyContinue) {
        Write-Log "Compress-Archive cmdlet available (zip equivalent)"
        return $true
    }
    Write-Warn "Neither zip nor Compress-Archive available. DOCX repacking may fail."
    return $true
}

function Test-NugetConfig {
    Write-Step "Checking NuGet configuration"
    try {
        $sources = & dotnet nuget list source 2>$null
        if ($sources -and ($sources -match 'nuget.org')) {
            Write-Log 'nuget.org source is configured'
            return
        }
        Write-Warn 'nuget.org not in sources. Adding...'
        & dotnet nuget add source 'https://api.nuget.org/v3/index.json' --name 'nuget.org' 2>&1 |
            Append-LogUtf8 | Out-Null
    } catch {
        Write-Warn "Could not validate NuGet sources: $_"
    }
}

function Build-DotnetProject {
    Write-Step "Building docx .NET project"
    if (-not (Test-Path $DotnetDir)) {
        Write-Fail "Dotnet project directory not found: $DotnetDir"
        return $false
    }
    Push-Location $DotnetDir
    try {
        Write-Info "Restoring NuGet packages..."
        & dotnet restore --verbosity quiet 2>&1 | Append-LogUtf8 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "NuGet restore failed. Common causes: no internet / corporate proxy blocking nuget.org / disk full."
            Write-Info "Diagnose with: dotnet restore --verbosity detailed"
            return $false
        }
        Write-Log "NuGet packages restored"

        Write-Info "Building project..."
        & dotnet build --verbosity quiet --no-restore 2>&1 | Append-LogUtf8 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "Build failed. Check $LogFile for details."
            return $false
        }
        Write-Log "Project built successfully"
        return $true
    } finally {
        Pop-Location
    }
}

function Test-Verification {
    Write-Step "Verification Test"
    $testOutput = Join-Path $env:TEMP "docx-setup-test-$PID.docx"
    Push-Location $DotnetDir
    try {
        Write-Info "Creating a test document..."
        & dotnet run --project MiniMaxAIDocx.Cli -- create --type report --output $testOutput --title 'Setup Test' 2>&1 |
            Append-LogUtf8 | Out-Null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $testOutput)) {
            Write-Fail "Test document creation failed. Check $LogFile for details."
            return $false
        }
        Write-Log "Test document created: $testOutput"
        Remove-Item $testOutput -Force -ErrorAction SilentlyContinue
        Write-Log "Test passed - docx is ready to use"
        return $true
    } finally {
        Pop-Location
    }
}

function Test-Fonts {
    Write-Step "Checking fonts"
    try {
        Add-Type -AssemblyName System.Drawing -ErrorAction Stop
        $names = [System.Drawing.FontFamily]::Families | ForEach-Object { $_.Name }
    } catch {
        Write-Info "Cannot enumerate fonts (System.Drawing unavailable). Skipping."
        return
    }
    if ($names -contains 'Calibri')         { Write-Log 'Western fonts: Calibri' }         else { Write-Warn 'Calibri missing — install Microsoft Office or fonts pack' }
    if ($names -contains 'Times New Roman') { Write-Log 'Western fonts: Times New Roman' } else { Write-Warn 'Times New Roman missing' }
    if ($names | Where-Object { $_ -match 'SimSun|Microsoft YaHei|MS Mincho|Malgun Gothic|Noto Sans CJK' }) {
        Write-Log 'CJK fonts: available'
    } else {
        Write-Warn 'CJK fonts not found — install Chinese/Japanese/Korean language packs'
    }
}

function Show-Summary {
    Write-Step "Setup Complete"
    $sof = Resolve-SofficePath; if (-not $sof) { $sof = 'NOT FOUND' }
    $pp  = Resolve-PdftoppmPath; if (-not $pp)  { $pp  = 'NOT FOUND' }
    $py  = Resolve-PythonCommand
    $pyDisp = if ($py) { "$($py.Cmd) $($py.Args -join ' ')" } else { 'NOT FOUND' }
    $dotnetVer = try { (& dotnet --version 2>$null) } catch { $null }
    if (-not $dotnetVer) { $dotnetVer = 'NOT FOUND' }
    $pandocVer = try { (& pandoc --version 2>$null | Select-Object -First 1) } catch { $null }
    if (-not $pandocVer) { $pandocVer = 'NOT FOUND' }

    Write-Host ""
    Write-Host ("  Environment: Windows {0}" -f [Environment]::OSVersion.Version)
    Write-Host ("  Level:       {0}" -f $Level)
    Write-Host ("  dotnet:      {0}" -f $dotnetVer)
    Write-Host ("  python:      {0}" -f $pyDisp)
    Write-Host ("  pandoc:      {0}" -f $pandocVer)
    Write-Host ("  pdftoppm:    {0}" -f $pp)
    Write-Host ("  soffice:     {0}" -f $sof)
    Write-Host ("  Project:     {0}" -f $DotnetDir)
    Write-Host ""
    Write-Host ("  Mandatory preflight: powershell -ExecutionPolicy Bypass -File {0}\env_check.ps1 -Level Read" -f $ScriptDir)
    Write-Host ("  Log file: {0}" -f $LogFile)
}

# ============ MAIN ============
$fatal = $false

# Read level (always)
if (-not (Install-Python))         { $fatal = $true }
Install-UnzipFallback | Out-Null
Test-Utf8Console      | Out-Null
Set-ScriptUnblock     | Out-Null

# Render level
if ($Level -in @('Render', 'Full')) {
    if (-not (Install-Soffice))    { $fatal = $true }
    if (-not (Install-Poppler))    { $fatal = $true }
}

# Full level
if ($Level -eq 'Full') {
    if (-not (Install-DotnetSdk))  { $fatal = $true }
    if (-not (Install-Pandoc))     { $fatal = $true }
    Install-ZipTools | Out-Null
    Test-NugetConfig
    if (-not $fatal) {
        if (-not (Build-DotnetProject)) { $fatal = $true }
    }
}

if (-not $Minimal -and $Level -eq 'Full') { Test-Fonts }

if (-not $fatal -and -not $SkipVerify -and $Level -eq 'Full') {
    if (-not (Test-Verification)) { $fatal = $true }
}

Show-Summary

if ($fatal) { exit 1 } else { exit 0 }

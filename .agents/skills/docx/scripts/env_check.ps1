# docx strict environment check (Windows PowerShell mirror of env_check.sh)
# Authoritative for whether the skill may run on Windows.
# Supports -Level Read|Render|Full (default Full). Output format and exit codes
# match env_check.sh so the daemon's gate hook can compare them line-by-line.
#Requires -Version 5.1

[CmdletBinding()]
param(
    # NOTE: intentionally NOT using [ValidateSet]. ValidateSet rejects with PowerShell exit 1
    # which would conflate "NOT READY" with "bad CLI args". env_check.sh exits 2 for bad args
    # and 1 for NOT READY; we mirror that with manual validation below.
    [string]$Level = 'Full'
)

$ErrorActionPreference = 'Stop'
# Same UTF-8 enforcement as setup.ps1: chcp first (so child processes inherit UTF-8 code page),
# then [Console]::OutputEncoding (so PowerShell's view of stdout/stderr matches).
try { & chcp.com 65001 *> $null } catch { }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.UTF8Encoding]::new()
$env:DOTNET_CLI_UI_LANGUAGE = 'en'

# Manual validation (mirror env_check.sh exit codes).
$ValidLevels = @('Read', 'Render', 'Full')
if ($ValidLevels -notcontains $Level) {
    [Console]::Error.WriteLine("Invalid -Level value: '$Level'. Must be one of: Read, Render, Full")
    exit 2
}

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$DotnetDir  = Join-Path $ScriptDir 'dotnet'
$DotnetRequiredMajor = 9

function Test-Command($Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

function Resolve-SofficePath {
    foreach ($n in @('soffice.exe', 'soffice')) {
        $cmd = Get-Command $n -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    $candidates = @(
        (Join-Path $env:ProgramFiles 'LibreOffice\program\soffice.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'LibreOffice\program\soffice.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\LibreOffice\program\soffice.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\soffice.exe'),
        (Join-Path $env:USERPROFILE  'scoop\apps\libreoffice\current\program\soffice.exe')
    ) | Where-Object { $_ }
    foreach ($p in $candidates) { if (Test-Path $p) { return (Resolve-Path $p).Path } }
    return $null
}

function Resolve-PdftoppmPath {
    foreach ($n in @('pdftoppm.exe', 'pdftoppm', 'pdftocairo.exe', 'pdftocairo')) {
        $cmd = Get-Command $n -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    $candidates = @(
        (Join-Path $env:USERPROFILE 'scoop\apps\poppler\current\bin\pdftoppm.exe'),
        (Join-Path $env:ProgramData 'chocolatey\bin\pdftoppm.exe')
    ) | Where-Object { $_ }
    foreach ($p in $candidates) { if (Test-Path $p) { return (Resolve-Path $p).Path } }
    return $null
}

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

Write-Host "=== docx Environment Check (level: $Level) ==="
Write-Host ""

$Status = 'READY'
# Failure buckets — populated by CheckFail-style helpers, rendered at the end
# so the remediation section can speak in categories instead of one line per tool.
$script:MissingTools  = New-Object System.Collections.Generic.List[string]
$script:LocaleBroken  = $false
$script:LocaleHealed  = $false   # set when console was forced to UTF-8 for this
                                 # session; READY path still emits an Advisory so
                                 # the "forced for this session" message points
                                 # the user at a persistent fix.
$script:LocaleHealedFrom = ''
$script:PermsBroken   = $false
$script:ProjectBroken = $false
# Match env_check.sh's `printf '[OK]      %-14s %s\n'` — 14-char left-justified column,
# ONE space separator, then the value. Without the explicit space, the format string
# `{0,-14}{1}` collapses when the name is exactly 14 chars wide.
function CheckOk   { param([string]$Name, [string]$Detail) Write-Host ("[OK]      {0,-14} {1}" -f $Name, $Detail) }
function CheckFail { param([string]$Name, [string]$Detail) Write-Host ("[FAIL]    {0,-14} {1}" -f $Name, $Detail); $script:Status = 'NOT READY' }
function MarkMissingTool { param([string]$Name) $script:MissingTools.Add($Name) | Out-Null }

# --- read-level checks (always run) ---

$py = Resolve-PythonCommand
if (-not $py) {
    CheckFail 'python3' 'not found'
    MarkMissingTool 'python (3.x)'
} else {
    $verLine = & $py.Cmd @($py.Args + '--version') 2>&1
    $verNum  = ($verLine -join ' ') -replace '.*?(\d+\.\d+(?:\.\d+)?).*', '$1'
    CheckOk 'python3' $verNum
}

# unzip OR tar.exe (Windows 10 1803+) OR built-in Expand-Archive — any of them counts
if (Test-Command unzip) {
    CheckOk 'unzip' 'available'
} elseif (Test-Command tar) {
    CheckOk 'unzip' 'tar.exe (Windows 10+ native, handles .zip)'
} elseif (Get-Command Expand-Archive -ErrorAction SilentlyContinue) {
    CheckOk 'unzip' 'Expand-Archive (PowerShell built-in)'
} else {
    CheckFail 'unzip' 'no zip extractor found (unzip / tar.exe / Expand-Archive)'
    MarkMissingTool 'unzip'
}

# Locale / encoding — UTF-8 console required for CJK
$enc = [Console]::OutputEncoding.WebName
if ($enc -match '^utf-?8$') {
    CheckOk 'locale' "console=$enc"
} else {
    # Try to force UTF-8 for this session and re-check
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $enc2 = [Console]::OutputEncoding.WebName
    if ($enc2 -match '^utf-?8$') {
        CheckOk 'locale' "console=$enc2 (forced for this session — see advisory below to persist)"
        $script:LocaleHealed = $true
        $script:LocaleHealedFrom = $enc
    } else {
        CheckFail 'locale' "console=$enc — UTF-8 required, cannot force"
        $script:LocaleBroken = $true
    }
}

# Permission analogue on Windows: scripts unblocked (no Mark-of-the-Web).
# A blocked script will throw on Get-Item with -Stream Zone.Identifier.
$blocked = 0
foreach ($s in (Get-ChildItem -Path $ScriptDir -File -Filter '*.ps1' -ErrorAction SilentlyContinue)) {
    try {
        $null = Get-Item -LiteralPath $s.FullName -Stream 'Zone.Identifier' -ErrorAction Stop
        $blocked++
    } catch {
        # No Zone.Identifier stream means NOT blocked — that's the desired state.
    }
}
if ($blocked -eq 0) {
    CheckOk 'permissions' 'all .ps1 scripts unblocked'
} else {
    CheckFail 'permissions' "$blocked .ps1 script(s) carry Mark-of-the-Web (run setup.ps1 to unblock)"
    $script:PermsBroken = $true
}

# --- render-level checks (render + full) ---

if ($Level -in @('Render', 'Full')) {
    $sof = Resolve-SofficePath
    if ($sof) { CheckOk 'soffice' $sof } else { CheckFail 'soffice' 'not found'; MarkMissingTool 'soffice.exe' }

    $pp = Resolve-PdftoppmPath
    if ($pp) { CheckOk 'pdftoppm' $pp } else { CheckFail 'pdftoppm' 'not found'; MarkMissingTool 'pdftoppm.exe' }
}

# --- full-level checks (full only) ---

if ($Level -eq 'Full') {
    if (-not (Test-Command dotnet)) {
        CheckFail 'dotnet' 'not found'
        MarkMissingTool 'dotnet'
    } else {
        $ver = (& dotnet --version 2>$null)
        if (-not $ver) { $ver = '0.0.0' }
        try {
            $major = [int](($ver -split '\.')[0])
        } catch { $major = 0 }
        if ($major -ge $DotnetRequiredMajor) {
            CheckOk 'dotnet' "$ver (>= $DotnetRequiredMajor.0)"
        } else {
            CheckFail 'dotnet' "$ver (requires >= $DotnetRequiredMajor.0)"
            MarkMissingTool "dotnet>=$DotnetRequiredMajor"
        }
    }

    if (-not (Test-Command pandoc)) {
        CheckFail 'pandoc' 'not found'
        MarkMissingTool 'pandoc'
    } else {
        $pv = ((& pandoc --version 2>$null | Select-Object -First 1) -replace '.*?(\d+\.\d+(?:\.\d+)?).*', '$1')
        CheckOk 'pandoc' $pv
    }

    if (Test-Command zip) {
        CheckOk 'zip' 'available'
    } elseif (Get-Command Compress-Archive -ErrorAction SilentlyContinue) {
        CheckOk 'zip' 'Compress-Archive (PowerShell built-in)'
    } else {
        CheckFail 'zip' 'no zip writer (zip.exe / Compress-Archive)'
        MarkMissingTool 'zip'
    }

    if (-not (Test-Path $DotnetDir -PathType Container)) {
        CheckFail 'project' "directory not found: $DotnetDir"
        $script:ProjectBroken = $true
    } else {
        $built = $false
        foreach ($tfm in @('net10.0', 'net9.0', 'net8.0')) {
            $dll = Join-Path $DotnetDir "MiniMaxAIDocx.Cli\bin\Debug\$tfm\MiniMaxAIDocx.Cli.dll"
            if (Test-Path $dll) { $built = $true; break }
        }
        if ($built) {
            CheckOk 'project' 'built'
        } else {
            try {
                & dotnet restore $DotnetDir --verbosity quiet *> $null
                if ($LASTEXITCODE -eq 0) {
                    & dotnet build $DotnetDir --verbosity quiet --no-restore *> $null
                    if ($LASTEXITCODE -eq 0) {
                        CheckOk 'project' 'restore+build succeeded'
                    } else {
                        CheckFail 'project' 'restore succeeded but build failed'
                        $script:ProjectBroken = $true
                    }
                } else {
                    CheckFail 'project' 'restore failed'
                    $script:ProjectBroken = $true
                }
            } catch {
                CheckFail 'project' "restore/build threw: $_"
                $script:ProjectBroken = $true
            }
        }
    }
}

Write-Host ""
if ($Status -eq 'READY') {
    Write-Host 'Status: READY'
    # Advisory — fulfils the "see advisory below to persist" promise on the
    # OK line. Not a failure (we keep exit 0 and READY status), just a nudge so
    # the next subprocess does not have to force UTF-8 again.
    if ($script:LocaleHealed) {
        Write-Host ''
        Write-Host '----- Advisory -----'
        Write-Host ''
        Write-Host "[locale] Console encoding was forced to UTF-8 for this session (was console=$($script:LocaleHealedFrom))."
        Write-Host '  Skill scripts in THIS PowerShell session will keep working — no further action needed.'
        Write-Host '  But every NEW process starts from scratch and must force again.'
        Write-Host '  To make UTF-8 sticky system-wide (Windows 10 1903+):'
        Write-Host '    Settings -> Time & Language -> Language & region ->'
        Write-Host '    Administrative language settings -> Change system locale ->'
        Write-Host '    check "Beta: Use Unicode UTF-8 for worldwide language support" -> reboot.'
        Write-Host '  Per-shell alternative, add to your $PROFILE so every PowerShell starts UTF-8:'
        Write-Host '    chcp.com 65001 | Out-Null'
        Write-Host '    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8'
    }
    exit 0
} else {
    Write-Host 'Status: NOT READY'
    Write-Host ''
    Write-Host '----- Remediation -----'

    # Locale block — most common subprocess pitfall, surface first.
    if ($script:LocaleBroken) {
        Write-Host ''
        Write-Host '[locale] PowerShell console is not UTF-8 and could not be forced.'
        Write-Host '  Caller (one-shot for this session, no system changes):'
        Write-Host '    chcp.com 65001 | Out-Null'
        Write-Host '    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8'
        Write-Host '  Persist (System-wide UTF-8 — Windows 10 1903+):'
        Write-Host '    Settings -> Time & Language -> Language & region ->'
        Write-Host '    Administrative language settings -> Change system locale ->'
        Write-Host '    check "Beta: Use Unicode UTF-8 for worldwide language support" -> reboot.'
        Write-Host '  Or, per-shell, add the two lines above to your $PROFILE.'
    }

    # Permissions / MOTW
    if ($script:PermsBroken) {
        Write-Host ''
        Write-Host '[permissions] Some .ps1 scripts carry Mark-of-the-Web. Fix:'
        Write-Host "    Get-ChildItem -Path '$ScriptDir' -Filter '*.ps1' | Unblock-File"
        Write-Host '  Or run scripts/setup.ps1 which unblocks as part of setup.'
    }

    # Missing tools — composite hint
    if ($script:MissingTools.Count -gt 0) {
        $toolList = ($script:MissingTools | Sort-Object -Unique) -join ' '
        Write-Host ''
        Write-Host "[missing tools] $toolList"
        Write-Host "  Recommended:  powershell -ExecutionPolicy Bypass -File `"$ScriptDir\setup.ps1`""
        Write-Host '  setup.ps1 handles winget/scoop/choco fallbacks automatically.'
    }

    # dotnet project build failure
    if ($script:ProjectBroken) {
        Write-Host ''
        Write-Host '[dotnet project] build/restore failed. To diagnose:'
        Write-Host "    dotnet restore `"$DotnetDir`" --verbosity normal"
        Write-Host "    dotnet build   `"$DotnetDir`" --verbosity normal --no-restore"
        Write-Host "  Common causes: dotnet SDK < $DotnetRequiredMajor.0, blocked NuGet feed,"
        Write-Host '  or a clobbered intermediate build. Try removing all bin/obj dirs under'
        Write-Host '  the dotnet project tree, then rebuild.'
    }

    Write-Host ''
    if ($Level -eq 'Read') {
        Write-Host 'The read-level gate requires: python (3.x), zip extractor, UTF-8 console, unblocked scripts.'
        Write-Host "Re-check: powershell -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -Level Read"
    } elseif ($Level -eq 'Render') {
        Write-Host 'The render-level gate requires read-level items plus: soffice.exe, pdftoppm.exe.'
        Write-Host "Re-check: powershell -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -Level Render"
    } else {
        Write-Host "The full-level gate requires render-level items plus: dotnet>=$DotnetRequiredMajor, pandoc, zip writer, built dotnet project."
        Write-Host "Re-check: powershell -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -Level Full"
    }
    exit 1
}

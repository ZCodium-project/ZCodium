# doc_to_docx.ps1 — Windows mirror of doc_to_docx.sh
# Convert .doc to .docx using LibreOffice (soffice.exe).
#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [string]$InputPath,

    [Parameter(Position = 1)]
    [string]$OutDir = '.'
)

$ErrorActionPreference = 'Stop'
# soffice.exe handles its own internal Unicode but emits stderr in the active console code page;
# we want UTF-8 so error messages render correctly on CN/JP/KR Windows.
try { & chcp.com 65001 *> $null } catch { }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.UTF8Encoding]::new()

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

if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
    Write-Host "Error: File not found: $InputPath" -ForegroundColor Red
    exit 1
}

$soffice = Resolve-SofficePath
if (-not $soffice) {
    Write-Host "Error: soffice.exe (LibreOffice) is required for .doc conversion but not found." -ForegroundColor Red
    Write-Host "Install: winget install TheDocumentFoundation.LibreOffice"
    Write-Host "Or: choco install libreoffice-fresh -y"
    Write-Host "Or download: https://www.libreoffice.org/download/"
    exit 1
}

$resolvedIn = (Resolve-Path -LiteralPath $InputPath).Path
$baseName   = [IO.Path]::GetFileNameWithoutExtension($resolvedIn)

if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}
$resolvedOut = (Resolve-Path -LiteralPath $OutDir).Path
$outputFile  = Join-Path $resolvedOut "$baseName.docx"

Write-Host "Converting: $resolvedIn -> $outputFile"

# soffice user profile must be unique per invocation to avoid the "another instance is already running" lock.
$profileDir = Join-Path $env:TEMP ("docx-soffice-profile-" + [System.IO.Path]::GetRandomFileName())
$profileUri = 'file:///' + ($profileDir -replace '\\', '/')

try {
    & $soffice `
        --headless `
        --norestore `
        --nolockcheck `
        "-env:UserInstallation=$profileUri" `
        --convert-to docx `
        --outdir $resolvedOut `
        $resolvedIn *> $null
    $code = $LASTEXITCODE

    if (-not (Test-Path -LiteralPath $outputFile)) {
        Write-Host "Error: Conversion failed. Output file not created: $outputFile (soffice exit=$code)" -ForegroundColor Red
        exit 1
    }
    Write-Host "Success: $outputFile"
} finally {
    Remove-Item -LiteralPath $profileDir -Recurse -Force -ErrorAction SilentlyContinue
}

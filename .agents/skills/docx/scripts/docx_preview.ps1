# docx_preview.ps1 — Windows mirror of docx_preview.sh
# Preview DOCX content as plain text (pandoc preferred, falls back to raw word/document.xml).
#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [string]$InputPath
)

$ErrorActionPreference = 'Stop'
# Force UTF-8 console code page first (chcp 65001) so child native processes (pandoc, tar.exe)
# see UTF-8 too. PS-only [Console]::OutputEncoding alone is not enough — child native processes
# inherit the chcp value, not PS's view of stdout.
try { & chcp.com 65001 *> $null } catch { }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.UTF8Encoding]::new()

if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
    Write-Host "Error: File not found: $InputPath" -ForegroundColor Red
    exit 1
}

$resolved = (Resolve-Path -LiteralPath $InputPath).Path
$item     = Get-Item -LiteralPath $resolved
$sizeKb   = [math]::Round($item.Length / 1KB, 1)
$base     = Split-Path -Leaf $resolved

Write-Host "=== DOCX Preview: $base ==="
Write-Host "File size: ${sizeKb} KB"

if (Get-Command pandoc -ErrorAction SilentlyContinue) {
    # 2>$null discards pandoc's stderr; capture stdout only.
    $content = & pandoc -f docx -t plain $resolved 2>$null
    # pandoc exit 0 = success even when the body is empty (cover-only DOCX). Don't truthy-check $content.
    if ($LASTEXITCODE -eq 0) {
        $joined = ($content -join "`n")
        # Word count: split on whitespace and filter empties
        $words  = ($joined -split '\s+' | Where-Object { $_ }).Count
        $pages  = [math]::Ceiling($words / 250)
        Write-Host "Word count: $words"
        Write-Host "Estimated pages: $pages"
        Write-Host "---"
        Write-Host $joined
        exit 0
    }
    Write-Host "(pandoc invocation failed (exit=$LASTEXITCODE), falling back to raw XML extract)" -ForegroundColor Yellow
} else {
    Write-Host "(pandoc not available, falling back to raw XML extract)" -ForegroundColor Yellow
}

Write-Host "---"

# Fallback: open the .docx (zip) and dump word/document.xml first 100 lines.
$tmpDir = Join-Path $env:TEMP ("docx-preview-" + [System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
try {
    # Prefer tar.exe (Windows 10+) — handles .zip natively, faster than Expand-Archive.
    if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
        & tar.exe -xf $resolved -C $tmpDir 'word/document.xml' 2>$null
    } else {
        # Expand-Archive needs .zip extension; copy with that extension first.
        $zipCopy = Join-Path $tmpDir 'doc.zip'
        Copy-Item -LiteralPath $resolved -Destination $zipCopy
        Expand-Archive -LiteralPath $zipCopy -DestinationPath $tmpDir -Force
    }
    $docXml = Join-Path $tmpDir 'word\document.xml'
    if (Test-Path -LiteralPath $docXml) {
        Get-Content -LiteralPath $docXml -TotalCount 100 -Encoding UTF8
    } else {
        Write-Host "Could not locate word/document.xml inside the package." -ForegroundColor Red
    }
} finally {
    Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

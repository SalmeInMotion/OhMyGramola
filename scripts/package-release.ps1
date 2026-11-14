# Builds a clean, distributable release ZIP for GitHub Releases (no private keys or personal paths)
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pkg = ((Get-Content -Path (Join-Path $projectRoot 'package.json') -Raw) -replace "^\uFEFF", "") | ConvertFrom-Json
$ver = $pkg.version

$distDir = Join-Path $projectRoot 'dist'
if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
}

$bundleName = "OhMyGramola-v$ver-Setup"
$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("ohmygramola-pkg-" + [guid]::NewGuid().ToString("N"))
$bundleDir = Join-Path $stagingRoot $bundleName
New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

try {
    Copy-Item -Path (Join-Path $projectRoot 'CSXS')    -Destination (Join-Path $bundleDir 'CSXS')    -Recurse -Force
    Copy-Item -Path (Join-Path $projectRoot 'host')    -Destination (Join-Path $bundleDir 'host')    -Recurse -Force
    Copy-Item -Path (Join-Path $projectRoot 'src')     -Destination (Join-Path $bundleDir 'src')     -Recurse -Force

    $scriptsDst = Join-Path $bundleDir 'scripts'
    New-Item -ItemType Directory -Path $scriptsDst -Force | Out-Null
    Copy-Item -Path (Join-Path $projectRoot 'scripts\install.ps1')     -Destination $scriptsDst -Force
    Copy-Item -Path (Join-Path $projectRoot 'scripts\install-gui.ps1') -Destination $scriptsDst -Force

    Copy-Item -Path (Join-Path $projectRoot 'Install-OhMyGramola.cmd') -Destination $bundleDir -Force
    Copy-Item -Path (Join-Path $projectRoot 'package.json')            -Destination $bundleDir -Force
    Copy-Item -Path (Join-Path $projectRoot 'README.md')               -Destination $bundleDir -Force
    if (Test-Path (Join-Path $projectRoot 'README-INSTALL.txt')) {
        Copy-Item -Path (Join-Path $projectRoot 'README-INSTALL.txt')  -Destination $bundleDir -Force
    }
    if (Test-Path (Join-Path $projectRoot 'LICENSE')) {
        Copy-Item -Path (Join-Path $projectRoot 'LICENSE')             -Destination $bundleDir -Force
    }
    if (Test-Path (Join-Path $projectRoot 'CHANGELOG.md')) {
        Copy-Item -Path (Join-Path $projectRoot 'CHANGELOG.md')        -Destination $bundleDir -Force
    }

    $zipPath = Join-Path $distDir "$bundleName.zip"
    $rootZipPath = Join-Path $projectRoot "$bundleName.zip"
    if (Test-Path $zipPath) { Remove-Item -Path $zipPath -Force }
    if (Test-Path $rootZipPath) { Remove-Item -Path $rootZipPath -Force }

    Compress-Archive -Path $bundleDir -DestinationPath $zipPath -CompressionLevel Optimal
    Copy-Item -Path $zipPath -Destination $rootZipPath -Force
    Write-Host "[OK] Packaged release archive (root): $rootZipPath" -ForegroundColor Green
    Write-Host "[OK] Packaged release archive (dist): $zipPath" -ForegroundColor Green
} finally {
    if (Test-Path $stagingRoot) {
        Remove-Item -Path $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

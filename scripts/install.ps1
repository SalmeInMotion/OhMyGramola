# OhMyGramola — CEP Extension Headless / CLI Installer for Adobe After Effects
[CmdletBinding()]
param(
    [string]$MusicFolder = "",
    [int]$MinMajorVersion = 17,
    [int]$MaxMajorVersion = 99,
    [int[]]$CsxsVersions = @(9, 10, 11, 12, 13, 14, 15, 16),
    [switch]$Silent
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestSrcPath = Join-Path $projectRoot 'CSXS\manifest.xml'
$destExtensionDir = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.salmeinmotion.free-royalties-music'

# Resolve version from package.json
$pkgJsonPath = Join-Path $projectRoot 'package.json'
$releaseVersion = "1.1.0"
if (Test-Path $pkgJsonPath) {
    try {
        $pkgObj = (Get-Content -Path $pkgJsonPath -Raw) -replace "^\uFEFF", "" | ConvertFrom-Json
        if ($pkgObj.version) { $releaseVersion = $pkgObj.version }
    } catch {}
}

# Resolve default Music Folder dynamically (keeps P:\IA\RRSS\Music on studio machine, %USERPROFILE%\Music\OhMyGramola elsewhere)
$destRuntimeCfg = Join-Path $destExtensionDir "runtime-config.json"
$existingJamendoId = $null
$existingMusicDir = $null
if (Test-Path $destRuntimeCfg) {
    try {
        $rawPrev = (Get-Content -Path $destRuntimeCfg -Raw) -replace "^\uFEFF", ""
        $prevCfg = $rawPrev | ConvertFrom-Json
        if ($prevCfg.defaultJamendoClientId) { $existingJamendoId = $prevCfg.defaultJamendoClientId }
        if ($prevCfg.defaultMusicDir) { $existingMusicDir = $prevCfg.defaultMusicDir }
    } catch {}
}

if ([string]::IsNullOrWhiteSpace($MusicFolder)) {
    if ($existingMusicDir) {
        $MusicFolder = $existingMusicDir
    } elseif (Test-Path 'P:\IA\RRSS') {
        $MusicFolder = 'P:\IA\RRSS\Music'
    } else {
        $MusicFolder = Join-Path ([Environment]::GetFolderPath('MyMusic')) 'OhMyGramola'
    }
}

$minStr = "{0}.0" -f $MinMajorVersion
$maxStr = if ($MaxMajorVersion -ge 99) { "99.9" } else { "{0}.9" -f $MaxMajorVersion }
$hostRange = "[$minStr,$maxStr]"

if (-not $Silent) {
    Write-Host "=========================================================" -ForegroundColor Cyan
    Write-Host "Installing OhMyGramola v$releaseVersion for After Effects" -ForegroundColor Cyan
    Write-Host "Source:      $projectRoot"
    Write-Host "Destination: $destExtensionDir"
    Write-Host "AE Range:    AEFT $hostRange"
    Write-Host "Music Dir:   $MusicFolder"
    Write-Host "=========================================================" -ForegroundColor Cyan
}

# 1. Enable PlayerDebugMode for selected CEP / CSXS versions (required for unsigned open-source CEP panels)
foreach ($ver in $CsxsVersions) {
    $keyPath = "HKCU:\Software\Adobe\CSXS.$ver"
    if (-not (Test-Path $keyPath)) {
        New-Item -Path $keyPath -Force | Out-Null
    }
    Set-ItemProperty -Path $keyPath -Name "PlayerDebugMode" -Value "1" -Force
}
if (-not $Silent) {
    Write-Host "[OK] CEP PlayerDebugMode enabled for CSXS: $($CsxsVersions -join ', ')" -ForegroundColor Green
}

# 2. Ensure local music directory exists
if (-not (Test-Path $MusicFolder)) {
    New-Item -ItemType Directory -Path $MusicFolder -Force | Out-Null
}
if (-not $Silent) {
    Write-Host "[OK] Verified local music folder: $MusicFolder" -ForegroundColor Green
}

# 3. Detect node.exe & ffmpeg.exe
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCmd) {
    $nodeCmd.Source
} elseif (Test-Path "C:\Program Files\nodejs\node.exe") {
    "C:\Program Files\nodejs\node.exe"
} else {
    $null
}

$ffCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffmpegPath = if ($ffCmd) {
    $ffCmd.Source
} elseif (Test-Path "C:\Program Files\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe") {
    "C:\Program Files\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe"
} elseif (Test-Path "C:\Program Files\ffmpeg\bin\ffmpeg.exe") {
    "C:\Program Files\ffmpeg\bin\ffmpeg.exe"
} elseif (Test-Path "C:\ffmpeg\bin\ffmpeg.exe") {
    "C:\ffmpeg\bin\ffmpeg.exe"
} else {
    $null
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# Write clean portable runtime-config.json in source root only if inside a dev repo (without user-specific music dir or API keys)
$sourceConfigObj = @{}
if ($nodePath) { $sourceConfigObj.nodePath = $nodePath }
if ($ffmpegPath) { $sourceConfigObj.ffmpegPath = $ffmpegPath }
$sourceCfgPath = Join-Path $projectRoot "runtime-config.json"
if (Test-Path (Join-Path $projectRoot "package.json")) {
    try {
        [System.IO.File]::WriteAllText($sourceCfgPath, ($sourceConfigObj | ConvertTo-Json), $utf8NoBom)
    } catch {}
}

if (-not $Silent) {
    if ($nodePath) {
        Write-Host "[OK] Configured Node.js path: $nodePath" -ForegroundColor Green
    } else {
        Write-Host "[WARN] Node.js not detected on PATH. Install Node.js LTS (https://nodejs.org) for live streaming & Jamendo proxy." -ForegroundColor Yellow
    }
    if ($ffmpegPath) {
        Write-Host "[OK] Configured FFmpeg path: $ffmpegPath" -ForegroundColor Green
    } else {
        Write-Host "[INFO] FFmpeg not found (panel will use WebAudio + AE timeline layer trim fallback)." -ForegroundColor Yellow
    }
}

# 4. Ensure destination subdirectories exist
$destCSXS = Join-Path $destExtensionDir "CSXS"
$destHost = Join-Path $destExtensionDir "host"
$destSrc  = Join-Path $destExtensionDir "src"

@($destExtensionDir, $destCSXS, $destHost, $destSrc) | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ -Force | Out-Null
    }
}

# 5. Copy extension files in-place
Copy-Item -Path (Join-Path $projectRoot "CSXS\*") -Destination $destCSXS -Recurse -Force
Copy-Item -Path (Join-Path $projectRoot "host\*") -Destination $destHost -Recurse -Force
Copy-Item -Path (Join-Path $projectRoot "src\*")  -Destination $destSrc  -Recurse -Force

# Tailor deployed manifest.xml Host Version range according to user selection
$targetManifest = Join-Path $destCSXS "manifest.xml"
if (Test-Path $targetManifest) {
    $manifestXml = [System.IO.File]::ReadAllText($targetManifest, $utf8NoBom)
    $manifestXml = $manifestXml -replace '(<Host\s+Name="AEFT"\s+Version=")[^"]+(")', "`${1}$hostRange`${2}"
    [System.IO.File]::WriteAllText($targetManifest, $manifestXml, $utf8NoBom)
}

# Write deployed runtime-config.json (preserving existing Jamendo ID + selected MusicFolder)
$destConfigObj = @{
    version         = $releaseVersion
    defaultMusicDir = $MusicFolder
}
if ($nodePath) { $destConfigObj.nodePath = $nodePath }
if ($ffmpegPath) { $destConfigObj.ffmpegPath = $ffmpegPath }
if ($existingJamendoId) { $destConfigObj.defaultJamendoClientId = $existingJamendoId }
[System.IO.File]::WriteAllText($destRuntimeCfg, ($destConfigObj | ConvertTo-Json), $utf8NoBom)

if (Test-Path (Join-Path $projectRoot ".debug")) {
    Copy-Item -Path (Join-Path $projectRoot ".debug") -Destination $destExtensionDir -Force
}

# 6. Verify manifest presence
if (Test-Path $targetManifest) {
    if (-not $Silent) {
        Write-Host "[OK] OhMyGramola v$releaseVersion deployed successfully!" -ForegroundColor Green
        Write-Host "Open Adobe After Effects -> Window -> Extensions -> OhMyGramola" -ForegroundColor Yellow
    }
} else {
    throw "Manifest verification failed at $targetManifest"
}

# OhMyGramola — Dark-Themed WinForms GUI Installer (SalmeInMotion Design v001)
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$projectRoot = Split-Path -Parent $PSScriptRoot
$installScript = Join-Path $PSScriptRoot 'install.ps1'
$destExtensionDir = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.salmeinmotion.free-royalties-music'

# Read version
$releaseVersion = "1.1.0"
$pkgPath = Join-Path $projectRoot 'package.json'
if (Test-Path $pkgPath) {
    try {
        $pkg = ((Get-Content -Path $pkgPath -Raw) -replace "^\uFEFF", "") | ConvertFrom-Json
        if ($pkg.version) { $releaseVersion = $pkg.version }
    } catch {}
}

# Resolve initial Music Folder
$defaultMusicDir = if (Test-Path 'P:\IA\RRSS') {
    'P:\IA\RRSS\Music'
} else {
    Join-Path ([Environment]::GetFolderPath('MyMusic')) 'OhMyGramola'
}
$destRuntimeCfg = Join-Path $destExtensionDir 'runtime-config.json'
if (Test-Path $destRuntimeCfg) {
    try {
        $prev = ((Get-Content -Path $destRuntimeCfg -Raw) -replace "^\uFEFF", "") | ConvertFrom-Json
        if ($prev.defaultMusicDir) { $defaultMusicDir = $prev.defaultMusicDir }
    } catch {}
}

# Detect installed Adobe After Effects versions on this PC
$aeCatalog = @(
    [PSCustomObject]@{ Year = "2020"; Label = "After Effects 2020 (v17.x)"; Major = 17; Csxs = @(9, 10) }
    [PSCustomObject]@{ Year = "2021"; Label = "After Effects 2021 (v18.x)"; Major = 18; Csxs = @(10, 11) }
    [PSCustomObject]@{ Year = "2022"; Label = "After Effects 2022 (v22.x)"; Major = 22; Csxs = @(11) }
    [PSCustomObject]@{ Year = "2023"; Label = "After Effects 2023 (v23.x)"; Major = 23; Csxs = @(11) }
    [PSCustomObject]@{ Year = "2024"; Label = "After Effects 2024 (v24.x)"; Major = 24; Csxs = @(11, 12) }
    [PSCustomObject]@{ Year = "2025"; Label = "After Effects 2025 (v25.x)"; Major = 25; Csxs = @(12) }
    [PSCustomObject]@{ Year = "2026"; Label = "After Effects 2026 / Beta (v26+)"; Major = 26; Csxs = @(12, 13, 14, 15, 16) }
)

$adobeRoot = "C:\Program Files\Adobe"
$detectedYears = New-Object System.Collections.Generic.HashSet[string]
if (Test-Path $adobeRoot) {
    Get-ChildItem -Path $adobeRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $n = $_.Name
        if ($n -match "After Effects\s+(\d{4})") {
            [void]$detectedYears.Add($Matches[1])
        } elseif ($n -match "After Effects\s*\(Beta\)") {
            [void]$detectedYears.Add("2026")
        }
    }
}

# Detect Node & FFmpeg status
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$hasNode = [bool]($nodeCmd -or (Test-Path "C:\Program Files\nodejs\node.exe"))
$ffCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
$hasFfmpeg = [bool]($ffCmd -or (Test-Path "C:\Program Files\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe") -or (Test-Path "C:\Program Files\ffmpeg\bin\ffmpeg.exe") -or (Test-Path "C:\ffmpeg\bin\ffmpeg.exe"))

# SalmeInMotion Design v001 Palette
$colBgApp     = [System.Drawing.Color]::FromArgb(21, 23, 27)    # #15171b
$colBgPanel   = [System.Drawing.Color]::FromArgb(29, 32, 38)    # #1d2026
$colBgRaised  = [System.Drawing.Color]::FromArgb(36, 40, 50)    # #242832
$colDivider   = [System.Drawing.Color]::FromArgb(52, 57, 70)    # #343946
$colTextMain  = [System.Drawing.Color]::FromArgb(241, 243, 247) # #f1f3f7
$colTextMuted = [System.Drawing.Color]::FromArgb(148, 156, 171) # #949cab
$colLime      = [System.Drawing.Color]::FromArgb(216, 255, 66)  # #d8ff42
$colBlue      = [System.Drawing.Color]::FromArgb(57, 141, 194)  # #398dc2
$colRed       = [System.Drawing.Color]::FromArgb(241, 108, 115) # #f16c73
$colDarkInk   = [System.Drawing.Color]::FromArgb(18, 19, 22)

$fontMain  = New-Object System.Drawing.Font("Segoe UI", 9.5, [System.Drawing.FontStyle]::Regular)
$fontBold  = New-Object System.Drawing.Font("Segoe UI", 9.5, [System.Drawing.FontStyle]::Bold)
$fontTitle = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$fontSmall = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Regular)

$form = New-Object System.Windows.Forms.Form
$form.Text = "OhMyGramola v$releaseVersion — Setup"
$form.ClientSize = New-Object System.Drawing.Size(520, 520)
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.BackColor = $colBgApp
$form.ForeColor = $colTextMain
$form.Font = $fontMain

# Header Panel
$headerPanel = New-Object System.Windows.Forms.Panel
$headerPanel.Location = New-Object System.Drawing.Point(0, 0)
$headerPanel.Size = New-Object System.Drawing.Size(520, 68)
$headerPanel.BackColor = $colBgPanel
$form.Controls.Add($headerPanel)

$badgeLbl = New-Object System.Windows.Forms.Label
$badgeLbl.Text = "CC"
$badgeLbl.BackColor = $colLime
$badgeLbl.ForeColor = $colDarkInk
$badgeLbl.Font = $fontBold
$badgeLbl.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$badgeLbl.Location = New-Object System.Drawing.Point(20, 16)
$badgeLbl.Size = New-Object System.Drawing.Size(32, 22)
$headerPanel.Controls.Add($badgeLbl)

$titleLbl = New-Object System.Windows.Forms.Label
$titleLbl.Text = "OhMyGramola  v$releaseVersion"
$titleLbl.Font = $fontTitle
$titleLbl.ForeColor = $colTextMain
$titleLbl.Location = New-Object System.Drawing.Point(60, 12)
$titleLbl.Size = New-Object System.Drawing.Size(340, 28)
$headerPanel.Controls.Add($titleLbl)

$subLbl = New-Object System.Windows.Forms.Label
$subLbl.Text = "Royalty-Free Music Browser, Waveform Trimmer & Importer for After Effects"
$subLbl.Font = $fontSmall
$subLbl.ForeColor = $colTextMuted
$subLbl.Location = New-Object System.Drawing.Point(20, 43)
$subLbl.Size = New-Object System.Drawing.Size(480, 18)
$headerPanel.Controls.Add($subLbl)

$headerLine = New-Object System.Windows.Forms.Panel
$headerLine.Location = New-Object System.Drawing.Point(0, 67)
$headerLine.Size = New-Object System.Drawing.Size(520, 1)
$headerLine.BackColor = $colDivider
$headerPanel.Controls.Add($headerLine)

# Section 1: After Effects Versions
$aeTitle = New-Object System.Windows.Forms.Label
$aeTitle.Text = "1. Target Adobe After Effects Versions"
$aeTitle.Font = $fontBold
$aeTitle.ForeColor = $colTextMain
$aeTitle.Location = New-Object System.Drawing.Point(20, 82)
$aeTitle.Size = New-Object System.Drawing.Size(340, 20)
$form.Controls.Add($aeTitle)

$chkAllFuture = New-Object System.Windows.Forms.CheckBox
$chkAllFuture.Text = "Enable for all compatible & future versions (AE 2020 - 2026+)"
$chkAllFuture.Font = $fontSmall
$chkAllFuture.ForeColor = $colLime
$chkAllFuture.Location = New-Object System.Drawing.Point(22, 105)
$chkAllFuture.Size = New-Object System.Drawing.Size(470, 20)
$chkAllFuture.Checked = $true
$form.Controls.Add($chkAllFuture)

$aeBox = New-Object System.Windows.Forms.Panel
$aeBox.Location = New-Object System.Drawing.Point(20, 130)
$aeBox.Size = New-Object System.Drawing.Size(480, 162)
$aeBox.BackColor = $colBgPanel
$aeBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$form.Controls.Add($aeBox)

$versionChecks = @()
$rowY = 8
foreach ($item in $aeCatalog) {
    $isInstalled = $detectedYears.Contains($item.Year)
    $cb = New-Object System.Windows.Forms.CheckBox
    $suffix = if ($isInstalled) { "   [Detected on this PC]" } else { "" }
    $cb.Text = "$($item.Label)$suffix"
    $cb.Tag = $item
    $cb.Font = if ($isInstalled) { $fontBold } else { $fontSmall }
    $cb.ForeColor = if ($isInstalled) { $colTextMain } else { $colTextMuted }
    $cb.Location = New-Object System.Drawing.Point(12, $rowY)
    $cb.Size = New-Object System.Drawing.Size(450, 20)
    $cb.Checked = ($isInstalled -or $detectedYears.Count -eq 0)
    $aeBox.Controls.Add($cb)
    $versionChecks += $cb
    $rowY += 21
}

# Section 2: Default Downloads / Local Library Folder
$dirTitle = New-Object System.Windows.Forms.Label
$dirTitle.Text = "2. Local Music & Downloads Folder"
$dirTitle.Font = $fontBold
$dirTitle.ForeColor = $colTextMain
$dirTitle.Location = New-Object System.Drawing.Point(20, 304)
$dirTitle.Size = New-Object System.Drawing.Size(480, 20)
$form.Controls.Add($dirTitle)

$txtMusicDir = New-Object System.Windows.Forms.TextBox
$txtMusicDir.Text = $defaultMusicDir
$txtMusicDir.BackColor = $colBgRaised
$txtMusicDir.ForeColor = $colTextMain
$txtMusicDir.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$txtMusicDir.Location = New-Object System.Drawing.Point(20, 327)
$txtMusicDir.Size = New-Object System.Drawing.Size(386, 25)
$form.Controls.Add($txtMusicDir)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = "Browse..."
$btnBrowse.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnBrowse.FlatAppearance.BorderColor = $colDivider
$btnBrowse.BackColor = $colBgRaised
$btnBrowse.ForeColor = $colTextMain
$btnBrowse.Location = New-Object System.Drawing.Point(414, 325)
$btnBrowse.Size = New-Object System.Drawing.Size(86, 26)
$btnBrowse.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = "Select folder where OhMyGramola will store downloaded music"
    $dlg.SelectedPath = $txtMusicDir.Text
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $txtMusicDir.Text = $dlg.SelectedPath
    }
})
$form.Controls.Add($btnBrowse)

# Section 3: Environment Diagnostics
$envPanel = New-Object System.Windows.Forms.Panel
$envPanel.Location = New-Object System.Drawing.Point(20, 364)
$envPanel.Size = New-Object System.Drawing.Size(480, 54)
$envPanel.BackColor = $colBgPanel
$envPanel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$form.Controls.Add($envPanel)

$nodeStatusLbl = New-Object System.Windows.Forms.Label
$nodeStatusLbl.Font = $fontSmall
$nodeStatusLbl.Location = New-Object System.Drawing.Point(10, 7)
$nodeStatusLbl.Size = New-Object System.Drawing.Size(460, 18)
if ($hasNode) {
    $nodeStatusLbl.Text = "✓ Node.js detected (Live HTTP streaming & firewall bypass ready)"
    $nodeStatusLbl.ForeColor = $colLime
} else {
    $nodeStatusLbl.Text = "⚠ Node.js not found — Install Node.js LTS from nodejs.org for online streaming"
    $nodeStatusLbl.ForeColor = $colRed
}
$envPanel.Controls.Add($nodeStatusLbl)

$ffStatusLbl = New-Object System.Windows.Forms.Label
$ffStatusLbl.Font = $fontSmall
$ffStatusLbl.Location = New-Object System.Drawing.Point(10, 28)
$ffStatusLbl.Size = New-Object System.Drawing.Size(460, 18)
if ($hasFfmpeg) {
    $ffStatusLbl.Text = "✓ FFmpeg detected (Live streaming waveforms & lossless MP3/WAV trim ready)"
    $ffStatusLbl.ForeColor = $colLime
} else {
    $ffStatusLbl.Text = "ℹ FFmpeg optional (Will use WebAudio live visualizer + AE timeline trim fallback)"
    $ffStatusLbl.ForeColor = $colTextMuted
}
$envPanel.Controls.Add($ffStatusLbl)

# Status Banner
$lblResult = New-Object System.Windows.Forms.Label
$lblResult.Text = "Ready to install to %APPDATA%\Adobe\CEP\extensions."
$lblResult.Font = $fontSmall
$lblResult.ForeColor = $colTextMuted
$lblResult.Location = New-Object System.Drawing.Point(20, 428)
$lblResult.Size = New-Object System.Drawing.Size(480, 30)
$form.Controls.Add($lblResult)

# Footer Buttons
$btnUninstall = New-Object System.Windows.Forms.Button
$btnUninstall.Text = "Uninstall"
$btnUninstall.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnUninstall.FlatAppearance.BorderColor = $colDivider
$btnUninstall.BackColor = $colBgPanel
$btnUninstall.ForeColor = $colRed
$btnUninstall.Location = New-Object System.Drawing.Point(20, 468)
$btnUninstall.Size = New-Object System.Drawing.Size(95, 34)
$btnUninstall.Add_Click({
    if (Test-Path $destExtensionDir) {
        $ans = [System.Windows.Forms.MessageBox]::Show(
            "Remove OhMyGramola from Adobe After Effects CEP extensions?`n(Your downloaded music files will NOT be deleted.)",
            "Uninstall OhMyGramola",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question
        )
        if ($ans -eq [System.Windows.Forms.DialogResult]::Yes) {
            Remove-Item -Path $destExtensionDir -Recurse -Force
            $lblResult.Text = "✓ Uninstalled from Adobe CEP extensions."
            $lblResult.ForeColor = $colTextMain
        }
    } else {
        $lblResult.Text = "OhMyGramola is not currently installed."
        $lblResult.ForeColor = $colTextMuted
    }
})
$form.Controls.Add($btnUninstall)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = "Close"
$btnClose.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnClose.FlatAppearance.BorderColor = $colDivider
$btnClose.BackColor = $colBgRaised
$btnClose.ForeColor = $colTextMain
$btnClose.Location = New-Object System.Drawing.Point(296, 468)
$btnClose.Size = New-Object System.Drawing.Size(88, 34)
$btnClose.Add_Click({ $form.Close() })
$form.Controls.Add($btnClose)

$btnInstall = New-Object System.Windows.Forms.Button
$btnInstall.Text = "Install OhMyGramola"
$btnInstall.Font = $fontBold
$btnInstall.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btnInstall.FlatAppearance.BorderSize = 0
$btnInstall.BackColor = $colLime
$btnInstall.ForeColor = $colDarkInk
$btnInstall.Location = New-Object System.Drawing.Point(392, 468)
$btnInstall.Size = New-Object System.Drawing.Size(108, 34)
$btnInstall.Text = "Install Now"
$btnInstall.Add_Click({
    try {
        $selectedItems = @($versionChecks | Where-Object { $_.Checked } | ForEach-Object { $_.Tag })
        if (-not $chkAllFuture.Checked -and $selectedItems.Count -eq 0) {
            [System.Windows.Forms.MessageBox]::Show(
                "Please select at least one After Effects version (or check 'Enable for all compatible & future versions').",
                "OhMyGramola Setup",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning
            ) | Out-Null
            return
        }

        if ($chkAllFuture.Checked) {
            $minMajor = 17
            $maxMajor = 99
            $csxsList = @(9, 10, 11, 12, 13, 14, 15, 16)
        } else {
            $majors = @($selectedItems | ForEach-Object { [int]$_.Major })
            $minMajor = ($majors | Measure-Object -Minimum).Minimum
            $maxMajor = ($majors | Measure-Object -Maximum).Maximum
            if ($maxMajor -ge 26) { $maxMajor = 99 }
            $csxsSet = New-Object System.Collections.Generic.HashSet[int]
            foreach ($it in $selectedItems) {
                foreach ($c in $it.Csxs) { [void]$csxsSet.Add([int]$c) }
            }
            $csxsList = @($csxsSet)
        }

        $targetMusic = $txtMusicDir.Text.Trim()
        & $installScript -MusicFolder $targetMusic -MinMajorVersion $minMajor -MaxMajorVersion $maxMajor -CsxsVersions $csxsList -Silent

        $lblResult.Text = "✓ Installed OhMyGramola v$releaseVersion! Open After Effects -> Window -> Extensions -> OhMyGramola."
        $lblResult.ForeColor = $colLime
        [System.Windows.Forms.MessageBox]::Show(
            "OhMyGramola v$releaseVersion has been installed successfully!`n`nIn Adobe After Effects, open:`nWindow -> Extensions -> OhMyGramola`n`n(If the panel is already open, right-click inside it and click Reload.)",
            "Installation Complete",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    } catch {
        $lblResult.Text = "✗ Error: $($_.Exception.Message)"
        $lblResult.ForeColor = $colRed
        [System.Windows.Forms.MessageBox]::Show(
            "Installation failed:`n$($_.Exception.Message)",
            "Installation Error",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
})
$form.Controls.Add($btnInstall)

[void]$form.ShowDialog()

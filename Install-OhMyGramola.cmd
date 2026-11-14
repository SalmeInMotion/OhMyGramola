@echo off
setlocal
title OhMyGramola Installer

:: Usage:
::   Double-click Install-OhMyGramola.cmd          -> Opens the GUI Installer (choose AE versions & music folder)
::   Install-OhMyGramola.cmd --silent              -> Instant 1-click CLI/headless install (AE 2020-2026+)

if /I "%~1"=="--silent" (
    echo Installing OhMyGramola silently...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
    exit /b %ERRORLEVEL%
)

if /I "%~1"=="/S" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1" -Silent
    exit /b %ERRORLEVEL%
)

:: Launch GUI installer without keeping a black console window behind it
start "" powershell -NoProfile -Sta -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0scripts\install-gui.ps1"
exit /b 0

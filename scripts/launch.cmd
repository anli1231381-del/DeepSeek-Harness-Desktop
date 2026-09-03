@echo off
set "HARNESS_DESKTOP_DATA=%~dp0data"
set "WEBVIEW2_USER_DATA_FOLDER=%~dp0webview-data"
start "" "%~dp0harness-desktop.exe"

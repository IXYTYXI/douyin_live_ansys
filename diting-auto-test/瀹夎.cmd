@echo off
setlocal
title Diting Live Capture Setup
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" echo Installation did not complete. Review the error above.
if "%EXIT_CODE%"=="0" echo Installer finished.
echo.
pause
exit /b %EXIT_CODE%

@echo off
setlocal
title Diting Live Capture Uninstall
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" echo Uninstall did not complete. Review the error above.
if "%EXIT_CODE%"=="0" echo Uninstaller finished.
echo.
pause
exit /b %EXIT_CODE%

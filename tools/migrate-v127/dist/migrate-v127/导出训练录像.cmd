@echo off
setlocal
rem ASCII-only on purpose: mixing UTF-8 Chinese into a batch file corrupts
rem cmd.exe parsing on some Windows builds. Chinese user-facing text lives
rem in launcher-messages.txt and is printed by launcher-print.ps1 via
rem PowerShell (dynamic values go through environment variables).
rem This folder (migrate-v127) is meant to live INSIDE the v1.2.7 package root,
rem so the bundled Node runtime sits at ..\runtime\node.exe.
chcp 65001 >nul
set "SCRIPT_DIR=%~dp0"
set "MIG_TOOL_DIR=%SCRIPT_DIR%"
set "MIG_MSG_FILE=%SCRIPT_DIR%launcher-messages.txt"
set "MIG_RT_FOUND=0"
set "MIG_EXPORTCJS_FOUND=0"
if exist "%SCRIPT_DIR%..\runtime\node.exe" set "MIG_RT_FOUND=1"
if exist "%SCRIPT_DIR%export-v127.cjs" set "MIG_EXPORTCJS_FOUND=1"
if "%MIG_RT_FOUND%"=="1" if "%MIG_EXPORTCJS_FOUND%"=="1" goto :run
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%launcher-print.ps1" export-place
pause
exit /b 1
:run
"%SCRIPT_DIR%..\runtime\node.exe" "%SCRIPT_DIR%export-v127.cjs" %*
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" exit /b 0
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%launcher-print.ps1" export-runfail
pause
exit /b %EXIT_CODE%

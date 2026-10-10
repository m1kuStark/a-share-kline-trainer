@echo off
setlocal
rem ASCII-only on purpose: mixing UTF-8 Chinese into a batch file corrupts
rem cmd.exe parsing on some Windows builds. All Chinese user-facing text is
rem printed by export-v127.cjs (Node writes Unicode to the console correctly).
rem This folder (migrate-v127) is meant to live INSIDE the v1.2.7 package root,
rem so the bundled Node runtime sits at ..\runtime\node.exe.
chcp 65001 >nul
set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%..\runtime\node.exe"
if exist "%NODE_EXE%" if exist "%SCRIPT_DIR%export-v127.cjs" goto :run
echo [error] Incomplete installation: ..\runtime\node.exe or export-v127.cjs is missing.
echo Folder: "%SCRIPT_DIR%"
echo Place the whole migrate-v127 folder inside the kline-trainer-v1.2.7-windows-x64
echo package root (next to Start.cmd), then double-click this file again.
echo.
pause
exit /b 1
:run
"%NODE_EXE%" "%SCRIPT_DIR%export-v127.cjs" %*
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" exit /b 0
echo.
echo [error] Migration export failed. See the hints above.
echo.
pause
exit /b %EXIT_CODE%

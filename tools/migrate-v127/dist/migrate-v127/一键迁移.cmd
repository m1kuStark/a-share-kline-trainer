@echo off
setlocal
rem MIG-ONECLICK-01 one-click migration entry (runs on BOTH sides):
rem  - v1.2.7 zip root: bundled Node runtime at ..\runtime\node.exe
rem  - v1.3.x install dir: the installed Electron exe runs as Node
rem    (ELECTRON_RUN_AS_NODE=1) so the same oneclick.cjs works there too.
rem ASCII-only on purpose: Chinese inside cmd files corrupts parsing on
rem some Windows builds. All user-facing text is printed by oneclick.cjs
rem (Node writes Unicode to the console correctly).
chcp 65001 >nul
set "SCRIPT_DIR=%~dp0"
set "NODE_EXE="
set "RUN_AS_NODE="

rem 1) v1.2.7 side: bundled node runtime next to the tool folder
if exist "%SCRIPT_DIR%..\runtime\node.exe" if exist "%SCRIPT_DIR%oneclick.cjs" (
  set "NODE_EXE=%SCRIPT_DIR%..\runtime\node.exe"
  goto :run
)

rem 2) v1.3.x side: first K*.exe next to the tool folder (product exe,
rem    naturally skipping NSIS "Uninstall *.exe"). When the wildcard has
rem    no match %%~fF stays a literal non-existent path and the
rem    "if exist" guard below rejects it.
set "ELECTRON_EXE="
for %%F in ("%SCRIPT_DIR%..\K*.exe") do if not defined ELECTRON_EXE set "ELECTRON_EXE=%%~fF"
if defined ELECTRON_EXE if exist "%ELECTRON_EXE%" if exist "%SCRIPT_DIR%oneclick.cjs" (
  set "NODE_EXE=%ELECTRON_EXE%"
  set "RUN_AS_NODE=1"
  goto :run
)
rem fallback: any exe next to the tool folder (renamed product exe)
set "ELECTRON_EXE="
for %%F in ("%SCRIPT_DIR%..\*.exe") do if not defined ELECTRON_EXE set "ELECTRON_EXE=%%~fF"
if defined ELECTRON_EXE if exist "%ELECTRON_EXE%" if exist "%SCRIPT_DIR%oneclick.cjs" (
  set "NODE_EXE=%ELECTRON_EXE%"
  set "RUN_AS_NODE=1"
  goto :run
)

echo [error] This tool folder must sit INSIDE either the old kline-trainer
echo v1.2.7 package root (next to Start.cmd and runtime\) or the new
echo v1.3.x install directory (next to the trainer .exe).
echo Folder: "%SCRIPT_DIR%"
echo Move the whole migrate-v127 folder there and double-click this file again.
echo.
pause
exit /b 1

:run
if "%RUN_AS_NODE%"=="1" set "ELECTRON_RUN_AS_NODE=1"
"%NODE_EXE%" "%SCRIPT_DIR%oneclick.cjs" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" echo [error] Migration did not complete. See the hints above.
pause
exit /b %EXIT_CODE%

@echo off
setlocal
rem MIG-ONECLICK-01 one-click migration entry (runs on BOTH sides):
rem  - v1.2.7 zip root: bundled Node runtime at ..\runtime\node.exe
rem  - v1.3.x install dir: the installed Electron exe runs as Node
rem    (ELECTRON_RUN_AS_NODE=1) so the same oneclick.cjs works there too.
rem MIG-ONECLICK-02: ASCII-only on purpose (Chinese inside cmd files
rem corrupts parsing on some Windows builds). Chinese user-facing text
rem lives in launcher-messages.txt and is printed by launcher-print.ps1
rem via PowerShell; dynamic values (folder path, detected features) are
rem passed through environment variables, never interpolated.
chcp 65001 >nul
set "SCRIPT_DIR=%~dp0"

rem feature flags for self-diagnostics (consumed by launcher-print.ps1)
set "MIG_TOOL_DIR=%SCRIPT_DIR%"
set "MIG_MSG_FILE=%SCRIPT_DIR%launcher-messages.txt"
set "MIG_RT_FOUND=0"
set "MIG_EXE_FOUND=0"
set "MIG_CJS_FOUND=0"
if exist "%SCRIPT_DIR%..\runtime\node.exe" set "MIG_RT_FOUND=1"
if exist "%SCRIPT_DIR%oneclick.cjs" set "MIG_CJS_FOUND=1"

rem 1) v1.2.7 side: bundled node runtime next to the tool folder
if "%MIG_RT_FOUND%"=="1" if "%MIG_CJS_FOUND%"=="1" (
  set "NODE_EXE=%SCRIPT_DIR%..\runtime\node.exe"
  goto :run
)

rem 2) v1.3.x side: first K*.exe next to the tool folder (product exe,
rem    naturally skipping NSIS "Uninstall *.exe"). When the wildcard has
rem    no match %%~fF stays a literal non-existent path and the
rem    "if exist" guard below rejects it.
set "ELECTRON_EXE="
for %%F in ("%SCRIPT_DIR%..\K*.exe") do if not defined ELECTRON_EXE set "ELECTRON_EXE=%%~fF"
if defined ELECTRON_EXE if exist "%ELECTRON_EXE%" if "%MIG_CJS_FOUND%"=="1" (
  set "MIG_EXE_FOUND=1"
  set "NODE_EXE=%ELECTRON_EXE%"
  set "RUN_AS_NODE=1"
  goto :run
)
rem fallback: any exe next to the tool folder (renamed product exe)
set "ELECTRON_EXE="
for %%F in ("%SCRIPT_DIR%..\*.exe") do if not defined ELECTRON_EXE set "ELECTRON_EXE=%%~fF"
if defined ELECTRON_EXE if exist "%ELECTRON_EXE%" (
  set "MIG_EXE_FOUND=1"
  if "%MIG_CJS_FOUND%"=="1" (
    set "NODE_EXE=%ELECTRON_EXE%"
    set "RUN_AS_NODE=1"
    goto :run
  )
)

rem failure path: Chinese message via the PowerShell printer
if "%MIG_CJS_FOUND%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%launcher-print.ps1" oneclick-incomplete
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%launcher-print.ps1" oneclick-place
)
pause
exit /b 1

:run
if "%RUN_AS_NODE%"=="1" set "ELECTRON_RUN_AS_NODE=1"
"%NODE_EXE%" "%SCRIPT_DIR%oneclick.cjs" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%launcher-print.ps1" oneclick-runfail
pause
exit /b %EXIT_CODE%

@echo off
setlocal
rem ASCII-only on purpose: mixing UTF-8 Chinese into a batch file corrupts
rem cmd.exe parsing on some Windows builds. All Chinese user-facing text is
rem printed by launcher.cjs (Node writes Unicode to the console correctly).
chcp 65001 >nul
set "SCRIPT_DIR=%~dp0"
set "NODE_EXE=%SCRIPT_DIR%runtime\node.exe"
if exist "%NODE_EXE%" if exist "%SCRIPT_DIR%launcher.cjs" goto :stop
echo [error] Incomplete installation: runtime\node.exe or launcher.cjs is missing.
echo Folder: "%SCRIPT_DIR%"
echo Please re-extract the full package.
echo.
pause
exit /b 1
:stop
rem PORT-02 semantics: --stop closes ALL trainer processes it can verify via the
rem /api/health identity check -- the state-recorded one first, then a system-wide
rem sweep of node processes running launcher.cjs or server\dist\index.js (orphans
rem from other installs included). Unknown or unverifiable processes are never
rem signaled; unconfirmed kills are reported with a non-zero exit code.
"%NODE_EXE%" "%SCRIPT_DIR%launcher.cjs" --stop %*
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" exit /b 0
echo.
echo [error] Stop failed or some trainer processes could not be confirmed closed.
echo See the hints above; the launcher only ends processes it verified as this
echo trainer via its health identity. Database and logs are kept in the data
echo directory (default: %USERPROFILE%\.a-share-kline-trainer).
echo.
pause
exit /b %EXIT_CODE%

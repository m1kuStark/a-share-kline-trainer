param([Parameter(Mandatory = $true)][string]$ExtractedPackage)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$ownedRuns = [IO.Path]::GetFullPath((Join-Path $repoRoot '.runs')) + [IO.Path]::DirectorySeparatorChar
$packageRoot = (Resolve-Path -LiteralPath $ExtractedPackage).Path
if (!$packageRoot.StartsWith($ownedRuns, [StringComparison]::OrdinalIgnoreCase)) { throw 'Smoke package must be an owned extraction under .runs.' }
$dataRoot = Join-Path $packageRoot '.acceptance-data'
if (Test-Path -LiteralPath $dataRoot) { throw 'Fresh extraction required; do not reuse a user profile.' }
$executables = @(Get-ChildItem -LiteralPath (Join-Path $packageRoot 'app') -Filter '*.exe' -File)
if ($executables.Count -ne 1) { throw 'Expected exactly one application executable.' }
$exePath = $executables[0].FullName
$receiptRoot = Join-Path $repoRoot 'docs\verification\2026-10\BUILDER-ACCEPT-01'
$stdout = Join-Path $receiptRoot 'zip-launcher-stdout.log'
$stderr = Join-Path $receiptRoot 'zip-launcher-stderr.log'
$launcherPath = Join-Path $packageRoot 'Start-Acceptance.cmd'
$launcher = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/c', ('""' + $launcherPath + '""')) -WorkingDirectory $packageRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
if (!$launcher.WaitForExit(45000)) { throw 'Acceptance CMD did not finish starting the application within 45 seconds.' }
$launcher.Refresh()
$launcherExit = $launcher.ExitCode
if ($null -ne $launcherExit -and $launcherExit -ne 0) { throw "Acceptance CMD failed: $launcherExit" }
$deadline = [DateTime]::UtcNow.AddSeconds(45)
$statePath = Join-Path $dataRoot 'trainer-state.json'
$state = $null
$application = $null
while ([DateTime]::UtcNow -lt $deadline) {
  if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $application = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
    if ($application) {
      if (![StringComparer]::OrdinalIgnoreCase.Equals($application.Path, $exePath)) { throw 'State belongs to an unexpected executable.' }
      $application.Refresh()
      if ($application.MainWindowHandle -ne 0) { break }
    }
  }
  Start-Sleep -Milliseconds 400
}
if (!$application -or $application.MainWindowHandle -eq 0) { throw 'No visible application window appeared.' }
if (![StringComparer]::OrdinalIgnoreCase.Equals($state.databasePath, (Join-Path $dataRoot 'trainer.sqlite'))) { throw 'Database escaped acceptance directory.' }
$processHandle = $application.Handle
$window = @{ handle = [string]$application.MainWindowHandle; title = $application.MainWindowTitle }
$commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($application.Id)").CommandLine
$profile = Join-Path $dataRoot 'profile'
if (!$commandLine.Contains($profile)) { throw 'Chromium profile is not inside the extraction.' }
$health = Invoke-RestMethod -Uri ($state.baseURL + '/api/health') -TimeoutSec 10
if ($health.runId -ne $state.runId -or $health.pid -ne $state.pid -or $health.status -ne 'ok') { throw 'Health identity does not match the owned state.' }
# Chromium may persist Local State shortly after the visible window/health becomes ready.
$profileFile = Join-Path $profile 'Local State'
$profileDeadline = [DateTime]::UtcNow.AddSeconds(30)
while (!(Test-Path -LiteralPath $profileFile) -and [DateTime]::UtcNow -lt $profileDeadline) {
  Start-Sleep -Milliseconds 250
}
if (!(Test-Path -LiteralPath $profileFile)) { throw 'Chromium profile was not created at the isolated path.' }
if (!$application.CloseMainWindow()) { throw 'Native window-close request was rejected.' }
if (!$application.WaitForExit(30000)) { throw 'Owned Electron process did not stop after native window close.' }
$application.Refresh()
$appExit = $application.ExitCode
if (Get-Process -Id $state.pid -ErrorAction SilentlyContinue) { throw 'Owned process still exists after close.' }
$receipt = [ordered]@{
  time = [DateTimeOffset]::Now.ToString('o')
  command = 'Start-Acceptance.cmd from a fresh extraction of the final ZIP'
  extraction = $packageRoot
  launcher_exit = $launcherExit
  app_exit = $appExit
  window = $window
  health = $health
  state = $state
  profile = $profile
  commandLine = $commandLine
  nativeCloseProcessGone = $true
  result = 'Final ZIP extraction: actual CMD displayed the app, used isolated database/profile, served matching health, and exited on native window close.'
}
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $receiptRoot 'zip-launcher-smoke.json') -Encoding UTF8
$receipt | ConvertTo-Json -Depth 8

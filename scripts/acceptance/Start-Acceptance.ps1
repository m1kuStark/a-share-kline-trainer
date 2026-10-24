param([string]$AcceptanceRoot = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$packageRoot = [IO.Path]::GetFullPath($AcceptanceRoot)
$exePath = Join-Path $packageRoot 'app\K线训练器.exe'
if (!(Test-Path -LiteralPath $exePath)) { throw 'Please extract the complete acceptance ZIP before starting.' }
$stateRoot = Join-Path $packageRoot '.acceptance-data'
$profileRoot = Join-Path $stateRoot 'profile'
$fakeHome = Join-Path $stateRoot 'home'
$fakeRoaming = Join-Path $fakeHome 'AppData\Roaming'
$fakeLocal = Join-Path $fakeHome 'AppData\Local'
$fakeTemp = Join-Path $fakeLocal 'Temp'
foreach ($directory in @($stateRoot, $profileRoot, $fakeHome, $fakeRoaming, $fakeLocal, $fakeTemp)) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
# Keep the origin stable across launches so recordings remain in the same IndexedDB.
$portFile = Join-Path $stateRoot 'port.txt'
if (Test-Path -LiteralPath $portFile) {
  $port = [int](Get-Content -LiteralPath $portFile -Raw)
  if ($port -lt 1024 -or $port -gt 65535) { throw 'Invalid acceptance port.txt; no application was started.' }
} else {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  [IO.File]::WriteAllText($portFile, [string]$port)
}
foreach ($entry in @(Get-ChildItem Env:)) {
  if ($entry.Name -like 'TRAINER_*' -or $entry.Name -like 'PORTABLE_EXECUTABLE*' -or $entry.Name -in @('ELECTRON_RUN_AS_NODE', 'DESKTOP_DEV_URL', 'NODE_OPTIONS', 'TDX_ROOT', 'HOST', 'PORT', 'OPEN_BROWSER')) {
    Remove-Item -LiteralPath ('Env:' + $entry.Name)
  }
}
$env:TRAINER_DATA_DIR = $stateRoot
$env:TRAINER_DB = Join-Path $stateRoot 'trainer.sqlite'
$env:TDX_ROOT = Join-Path $packageRoot 'sample-market'
$env:PORT = [string]$port
$env:OPEN_BROWSER = '0'
$env:USERPROFILE = $fakeHome
$env:HOMEDRIVE = [IO.Path]::GetPathRoot($fakeHome).TrimEnd('\')
$env:HOMEPATH = $fakeHome.Substring($env:HOMEDRIVE.Length)
$env:APPDATA = $fakeRoaming
$env:LOCALAPPDATA = $fakeLocal
$env:TEMP = $fakeTemp
$env:TMP = $fakeTemp
# No global execution-policy, registry, shell association or installed-app changes.
# This is the interactive application the user is opening, so show its window.
$process = Start-Process -FilePath $exePath -ArgumentList @('--user-data-dir="' + $profileRoot + '"') -WorkingDirectory $packageRoot -WindowStyle Normal -PassThru
Write-Output ('Acceptance started. PID=' + $process.Id + '; data=' + $stateRoot)

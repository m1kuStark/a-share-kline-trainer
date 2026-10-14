# MIG-ONECLICK-02 launcher message printer. ASCII-only on purpose:
# Chinese text inside .cmd/.ps1 files corrupts cmd.exe parsing on some
# Windows builds. All Chinese user-facing text lives in
# launcher-messages.txt (UTF-8) next to this script. Dynamic values
# (tool folder path, detected features) arrive via environment
# variables set by the .cmd launcher, so nothing user-controlled is
# ever interpolated into this script.
# Usage: launcher-print.ps1 <scene>
#   scenes: oneclick-place | oneclick-incomplete | oneclick-runfail |
#           export-place | export-runfail
# Exit code is always 1 (the printer is only invoked on failure paths).
param([Parameter(Mandatory = $true)][string]$Scene)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$msgFile = $env:MIG_MSG_FILE
if (-not $msgFile) { $msgFile = Join-Path $PSScriptRoot 'launcher-messages.txt' }
$sections = @{}
try {
  $current = $null
  foreach ($line in [System.IO.File]::ReadAllLines($msgFile, [System.Text.Encoding]::UTF8)) {
    if ($line -match '^\[(.+)\]\s*$') {
      $current = $Matches[1]
      $sections[$current] = ''
      continue
    }
    if ($null -ne $current) {
      if ($sections[$current].Length -eq 0) { $sections[$current] = $line }
      else { $sections[$current] = $sections[$current] + [Environment]::NewLine + $line }
    }
  }
} catch {
  Write-Host '[error] cannot read launcher-messages.txt'
  exit 3
}

function Get-Section([string]$Name) {
  if ($sections.ContainsKey($Name)) { return $sections[$Name] }
  return ''
}
function Get-Feature([string]$EnvName, [string]$FoundSection, [string]$MissingSection) {
  if ([Environment]::GetEnvironmentVariable($EnvName) -eq '1') { return Get-Section $FoundSection }
  return Get-Section $MissingSection
}

$nl = [Environment]::NewLine
$toolDir = [Environment]::GetEnvironmentVariable('MIG_TOOL_DIR')
$rt = Get-Feature 'MIG_RT_FOUND' 'feat-rt-found' 'feat-rt-missing'
$exe = Get-Feature 'MIG_EXE_FOUND' 'feat-exe-found' 'feat-exe-missing'
$out = switch ($Scene) {
  'oneclick-place' {
    (Get-Section 'oneclick-title') + $nl + (Get-Section 'feature-title') + $nl + $rt + $nl + $exe + $nl + $nl + (Get-Section 'oneclick-guide').Replace('{TOOL_DIR}', $toolDir)
  }
  'oneclick-incomplete' {
    (Get-Section 'oneclick-incomplete-title') + $nl + (Get-Section 'feature-title') + $nl + $rt + $nl + $exe + $nl + (Get-Section 'feat-cjs-missing') + $nl + $nl + (Get-Section 'oneclick-incomplete-guide').Replace('{TOOL_DIR}', $toolDir)
  }
  'oneclick-runfail' { Get-Section 'oneclick-runfail' }
  'export-place' {
    $exportCjs = Get-Feature 'MIG_EXPORTCJS_FOUND' 'feat-exportcjs-found' 'feat-exportcjs-missing'
    (Get-Section 'export-title') + $nl + (Get-Section 'feature-title') + $nl + $rt + $nl + $exportCjs + $nl + $nl + (Get-Section 'export-guide').Replace('{TOOL_DIR}', $toolDir)
  }
  'export-runfail' { Get-Section 'export-runfail' }
  default { '[error] unknown scene: ' + $Scene }
}
if ($out) { Write-Host $out }
exit 1

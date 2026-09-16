$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$baselineExit = 0
try {
    foreach ($step in @('docs:check', 'docs:status -- --check', 'test', 'build')) {
        $stepArgs = $step -split ' '
        & npm run @stepArgs
        if ($LASTEXITCODE -ne 0) { throw "Baseline step failed: $step ($LASTEXITCODE)" }
    }
    & npx --no-install tsx scripts/verify-m2.ts
    if ($LASTEXITCODE -ne 0) { throw "M2 verification failed ($LASTEXITCODE)" }
    & npm run journey -- --retries=0
    if ($LASTEXITCODE -ne 0) { throw "Journey failed ($LASTEXITCODE)" }
} catch {
    Write-Error $_ -ErrorAction Continue
    $baselineExit = 1
} finally {
    & npm run build:web
    if ($LASTEXITCODE -ne 0) { $baselineExit = 1 }
}
exit $baselineExit

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

& npm test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& npx --no-install tsx scripts/verify-m1.ts
exit $LASTEXITCODE

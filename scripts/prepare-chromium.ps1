$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'prepare-chromium.mjs'
& node $script @args
exit $LASTEXITCODE

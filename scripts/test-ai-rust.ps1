param([string]$Filter = 'ai_assistant')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    $artifacts = & cargo test --locked --manifest-path src-tauri/Cargo.toml --lib --no-run --message-format=json | ForEach-Object {
        try { $record = $_ | ConvertFrom-Json } catch { return }
        if ($record.reason -eq 'compiler-artifact' -and $record.profile.test -and $record.executable) { $record.executable }
    }
    if ($LASTEXITCODE -ne 0) { throw 'Rust test compilation failed' }
    $testExecutable = $artifacts | Select-Object -Last 1
    if (-not $testExecutable) { throw 'Cargo returned no test executable' }
    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
        # Cargo's rustc-link-arg-tests excludes lib-test harnesses. Embed common-controls
        # v6 only in this test executable; the production manifest remains Tauri-owned.
        $expectedRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'src-tauri/target/debug/deps')) + [IO.Path]::DirectorySeparatorChar
        if (-not [IO.Path]::GetFullPath($testExecutable).StartsWith($expectedRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected test executable path' }
        $kitRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
        $manifestTool = Get-ChildItem -LiteralPath $kitRoot -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'x64/mt.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if (-not $manifestTool) { throw 'Windows SDK mt.exe is required for lib tests' }
        $manifest = Join-Path $repoRoot 'src-tauri/tests/common-controls.manifest'
        & $manifestTool -nologo -manifest $manifest "-outputresource:$testExecutable;#1"
        if ($LASTEXITCODE -ne 0) { throw 'Unable to embed test manifest' }
    }
    & $testExecutable $Filter --nocapture
    $testExitCode = $LASTEXITCODE
} finally { Pop-Location }
exit $testExitCode

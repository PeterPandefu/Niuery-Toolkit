$ErrorActionPreference = 'Stop'

$cacheRoot = Join-Path $env:LOCALAPPDATA 'ms-playwright'
$source = Get-ChildItem -LiteralPath $cacheRoot -Directory -Filter 'chromium_headless_shell-*' |
  Sort-Object Name -Descending |
  Select-Object -First 1
if (-not $source) {
  throw '未找到 Playwright Chromium Headless Shell，请先运行 npx playwright install chromium-headless-shell'
}

$executable = Join-Path $source.FullName 'chrome-headless-shell-win64\chrome-headless-shell.exe'
if (-not (Test-Path -LiteralPath $executable)) {
  throw "Chromium 可执行文件不存在：$executable"
}

$target = Join-Path $PSScriptRoot '..\src-tauri\resources\chromium\win-x64'
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $source.FullName 'chrome-headless-shell-win64\*') -Destination $target -Recurse -Force
if (-not (Test-Path -LiteralPath (Join-Path $target 'chrome-headless-shell.exe'))) {
  throw "复制 Chromium 失败：$target"
}
Write-Host "已准备 Chromium：$target"

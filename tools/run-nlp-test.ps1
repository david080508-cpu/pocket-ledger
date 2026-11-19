# 用 Edge 无头模式跑 tools/nlp-test.html，输出解析器测试结果
# 用法: powershell -ExecutionPolicy Bypass -File tools\run-nlp-test.ps1
param([string]$Project = (Split-Path -Parent $PSScriptRoot))

$edge = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edge) { Write-Host "msedge.exe not found"; exit 2 }

$tmp = Join-Path $Project ".edge-tmp"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$out = Join-Path $tmp "dom.txt"

$url = "file:///" + ($Project -replace '\\', '/') + "/tools/nlp-test.html"
$p = Start-Process -FilePath $edge -ArgumentList @(
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  "--user-data-dir=$tmp\profile", '--virtual-time-budget=6000', '--dump-dom', $url
) -Wait -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError "$tmp\err.txt"

$text = Get-Content $out -Raw
$clean = $text -replace '<[^>]+>', "`n"
$lines = $clean -split "`n" | Where-Object { $_ -match '^\s*(PASS|FAIL|RESULT|got|want)' } | ForEach-Object { $_.Trim() }
$lines -join "`n"
$result = ($text | Select-String -Pattern 'RESULT: (\d+) passed, (\d+) failed' -AllMatches).Matches
if ($result.Count -gt 0 -and $result[0].Groups[2].Value -ne '0') { exit 1 }
exit 0

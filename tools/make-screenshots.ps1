# 用无头 Edge 生成 README 截图（写入 docs/preview-*.png）
# 会在 assets 下临时生成 _preview_*.html，截图后删除。
param(
  [string]$Project = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$edge = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw '找不到 msedge.exe' }

$app = Join-Path $Project 'app\src\main\assets\app'
$docs = Join-Path $Project 'docs'
New-Item -ItemType Directory -Force -Path $docs | Out-Null

$utf8 = New-Object System.Text.UTF8Encoding($false)
$html = [System.IO.File]::ReadAllText((Join-Path $app 'index.html'), [System.Text.Encoding]::UTF8)

$seed = @'
<script>
(function () {
  var recs = [], today = new Date();
  function p(n) { return n < 10 ? '0' + n : '' + n; }
  function d(off) { var t = new Date(today.getTime() - off * 86400000); return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()); }
  function add(type, cat, cents, note, off) { recs.push({ id: 's' + recs.length, type: type, amountCents: cents, category: cat, note: note, date: d(off), createdAt: Date.now() }); }
  add('income', 'other', 5000, '妈妈给', 0);
  add('expense', 'food', 2500, '中饭', 0);
  add('expense', 'transport', 1200, '地铁', 1);
  add('expense', 'food', 1800, '午饭吃面', 1);
  add('expense', 'shopping', 39900, '买了双鞋', 2);
  add('income', 'salary', 800000, '发工资', 5);
  add('expense', 'home', 250000, '房租', 5);
  localStorage.setItem('pocket.ledger.v1', JSON.stringify({ version: 1, records: recs }));
})();
</script>
'@

$homeHtml = $html.Replace('<script src="nlp.js">', $seed + '<script src="nlp.js">')
$tmpHome = Join-Path $app '_preview_home.html'
[System.IO.File]::WriteAllText($tmpHome, $homeHtml, $utf8)

$talkJs = @'
<script>
setTimeout(function () {
  document.getElementById('talk').classList.add('on');
  document.getElementById('talkInput').value = '妈妈给了我50块钱，然后中饭花了25块钱';
  document.getElementById('talkParse').click();
}, 500);
</script>
'@
$tmpTalk = Join-Path $app '_preview_talk.html'
[System.IO.File]::WriteAllText($tmpTalk, $homeHtml.Replace('</body>', $talkJs + '</body>'), $utf8)

$frames = @{}
foreach ($name in 'home', 'talk') {
  $frames[$name] = Join-Path $app "_frame_$name.html"
  $frame = @"
<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#efe7da;display:flex;justify-content:center}
  .phone{width:390px;height:844px;margin:24px auto;border-radius:28px;overflow:hidden;
         box-shadow:0 18px 50px rgba(90,60,10,.28);background:#fff}
  iframe{width:390px;height:844px;border:0;display:block}
  body{min-height:900px}
</style></head>
<body><div class="phone"><iframe src="_preview_$name.html"></iframe></div></body></html>
"@
  [System.IO.File]::WriteAllText($frames[$name], $frame, $utf8)
}

try {
  foreach ($name in 'home', 'talk') {
    $png = Join-Path $docs "preview-$name.png"
    Remove-Item $png -Force -ErrorAction SilentlyContinue
    $url = 'file:///' + ($app -replace '\\', '/') + "/_frame_$name.html"
    Start-Process -FilePath $edge -ArgumentList @(
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
      "--user-data-dir=$env:TEMP\edge-shot-$name", '--window-size=620,940',
      '--force-device-scale-factor=2', '--virtual-time-budget=6000', "--screenshot=$png", $url
    ) -Wait -NoNewWindow | Out-Null
    if (-not (Test-Path $png)) { throw "截图失败: $name" }
    Write-Host ("{0} ({1} KB)" -f $png, [math]::Round((Get-Item $png).Length / 1KB))
  }
} finally {
  Remove-Item $tmpHome, $tmpTalk -Force -ErrorAction SilentlyContinue
  foreach ($f in $frames.Values) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
}

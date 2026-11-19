# 手工安装 Android SDK 组件（sdkmanager 无法访问 Google 源时使用）
# 用 curl 直接下载官方 zip，解压成 SDK 目录结构，并写入 license 文件。
param(
  [Parameter(Mandatory = $true)][string]$Root
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$tc = Join-Path $Root '.toolchain'
$dl = Join-Path $tc 'dl'
$sdk = Join-Path $tc 'android-sdk'
$log = Join-Path $tc 'sdk-manual.log'
New-Item -ItemType Directory -Force -Path $dl, $sdk | Out-Null
Set-Content -Path $log -Value "" -Encoding UTF8

function Log([string]$m) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m
  Write-Host $line
  Add-Content -Path $log -Value $line -Encoding UTF8
}

function Fetch([string]$Url, [string]$Out) {
  $f = Get-Item $Out -ErrorAction SilentlyContinue
  if ($f -and $f.Length -gt 100KB) { Log "skip $Out"; return $true }
  Log "GET $Url"
  & curl.exe -L --fail --retry 3 --connect-timeout 20 --max-time 1800 -sS -o $Out $Url
  if ($LASTEXITCODE -ne 0) { Log "FAILED $Url"; return $false }
  Log ("OK {0} ({1} MB)" -f $Out, [math]::Round((Get-Item $Out).Length / 1MB, 1))
  return $true
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Unzip([string]$Zip, [string]$Dest) {
  if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  [System.IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Dest)
}

# ---------- platform-tools ----------
$zip = Join-Path $dl 'platform-tools.zip'
if (Fetch 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' $zip) {
  $tmp = Join-Path $tc 'pt-tmp'
  Unzip $zip $tmp
  if (Test-Path (Join-Path $sdk 'platform-tools')) { Remove-Item -Recurse -Force (Join-Path $sdk 'platform-tools') }
  Move-Item (Join-Path $tmp 'platform-tools') (Join-Path $sdk 'platform-tools')
  Remove-Item -Recurse -Force $tmp
  Log 'platform-tools installed'
}

# ---------- build-tools 34.0.0 ----------
$btCandidates = @(
  'https://dl.google.com/android/repository/build-tools_r34-windows.zip',
  'https://dl.google.com/android/repository/build-tools_r34.0.0-windows.zip'
)
$zip = Join-Path $dl 'build-tools-34.zip'
$ok = $false
foreach ($u in $btCandidates) { if (Fetch $u $zip) { $ok = $true; break } }
if ($ok) {
  $tmp = Join-Path $tc 'bt-tmp'
  Unzip $zip $tmp
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  $target = Join-Path $sdk 'build-tools\34.0.0'
  if (Test-Path (Join-Path $sdk 'build-tools')) { Remove-Item -Recurse -Force (Join-Path $sdk 'build-tools') }
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Copy-Item (Join-Path $inner.FullName '*') $target -Recurse -Force
  Remove-Item -Recurse -Force $tmp
  Log "build-tools 34.0.0 installed (from $($inner.Name))"
}

# ---------- platform android-34 ----------
$platCandidates = @(
  'https://dl.google.com/android/repository/platform-34_r03.zip',
  'https://dl.google.com/android/repository/platform-34_r02.zip',
  'https://dl.google.com/android/repository/platform-34_r01.zip'
)
$zip = Join-Path $dl 'platform-34.zip'
$ok = $false
foreach ($u in $platCandidates) { if (Fetch $u $zip) { $ok = $true; break } }
if ($ok) {
  $tmp = Join-Path $tc 'plat-tmp'
  Unzip $zip $tmp
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  $target = Join-Path $sdk 'platforms\android-34'
  $parent = Join-Path $sdk 'platforms'
  if (Test-Path $parent) { Remove-Item -Recurse -Force $parent }
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Copy-Item (Join-Path $inner.FullName '*') $target -Recurse -Force
  Remove-Item -Recurse -Force $tmp
  Log "platform android-34 installed (from $($inner.Name))"
} else {
  Log 'WARNING: platform android-34 not downloaded'
}

# ---------- licenses (AGP 会检查) ----------
$lic = Join-Path $sdk 'licenses'
New-Item -ItemType Directory -Force -Path $lic | Out-Null
$hashes = @(
  '24333f8a63b6825ea9c5514f83c2829b004d1fee',
  'd56f5187479451eabf01fb78af6dfcb131a6481e',
  '33b6a2b64607f11b759f320ef9dff4ae5c47d97a'
)
Set-Content -Path (Join-Path $lic 'android-sdk-license') -Value $hashes -Encoding ASCII
Set-Content -Path (Join-Path $lic 'android-sdk-preview-license') -Value '84831b9409646a918e30573bab4c9c91346d8abd' -Encoding ASCII
Log 'licenses written'

# ---------- 校验 ----------
$checks = @{
  'aapt2'      = (Join-Path $sdk 'build-tools\34.0.0\aapt2.exe')
  'android.jar' = (Join-Path $sdk 'platforms\android-34\android.jar')
  'd8'         = (Join-Path $sdk 'build-tools\34.0.0\d8.bat')
  'apksigner'  = (Join-Path $sdk 'build-tools\34.0.0\apksigner.bat')
  'adb'        = (Join-Path $sdk 'platform-tools\adb.exe')
}
foreach ($k in $checks.Keys) { Log ("check {0}: {1}" -f $k, (Test-Path $checks[$k])) }

Log 'SDK MANUAL INSTALL DONE'

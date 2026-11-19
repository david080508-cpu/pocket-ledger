# 发布新版本：改版本号 → 构建 → 校验签名 → 复制到 dist
# 用法: powershell -ExecutionPolicy Bypass -File tools\release.ps1 -Version 1.0.1
param(
  [Parameter(Mandatory = $true)][string]$Version,          # 例如 1.0.1
  [string]$Project = (Split-Path -Parent $PSScriptRoot),
  [string]$DistDir = ''
)

$ErrorActionPreference = 'Stop'

$gradleFile = Join-Path $Project 'app\build.gradle'
$gradle = [System.IO.File]::ReadAllText($gradleFile, [System.Text.Encoding]::UTF8)

$m = [regex]::Match($gradle, 'versionCode (\d+)')
if (-not $m.Success) { throw 'app/build.gradle 里找不到 versionCode' }
$newCode = [int]$m.Groups[1].Value + 1

$gradle = [regex]::Replace($gradle, 'versionCode \d+', "versionCode $newCode")
$gradle = [regex]::Replace($gradle, 'versionName "[^"]*"', "versionName `"$Version`"")
[System.IO.File]::WriteAllText($gradleFile, $gradle, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "versionCode -> $newCode, versionName -> $Version" -ForegroundColor Cyan

& (Join-Path $PSScriptRoot 'build.ps1') -Release -Project $Project
if ($LASTEXITCODE -ne 0) { throw '构建失败' }

$tc = Join-Path (Split-Path -Parent $Project) '.toolchain'
if (-not (Test-Path $tc)) { $tc = Join-Path $Project '.toolchain' }
$apk = Join-Path $Project 'app\build\outputs\apk\release\app-release.apk'

if (-not $DistDir) { $DistDir = Join-Path (Split-Path -Parent $Project) 'dist' }
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
$target = Join-Path $DistDir "pocket-ledger-$Version.apk"
Copy-Item $apk $target -Force

Write-Host ''
Write-Host "APK: $target" -ForegroundColor Green
Write-Host ("size: {0} KB" -f [math]::Round((Get-Item $target).Length / 1KB, 1))
Write-Host ("sha256: " + (Get-FileHash $target -Algorithm SHA256).Hash)

$apksigner = Join-Path $tc 'android-sdk\build-tools\34.0.0\apksigner.bat'
if (Test-Path $apksigner) {
  $env:JAVA_HOME = Join-Path $tc 'jdk'
  $cert = & $apksigner verify --print-certs $target 2>&1 | Select-String 'SHA-256 digest'
  Write-Host ("signing cert: " + ($cert -replace '.*SHA-256 digest: ', ''))
  Write-Host '（换版本时指纹必须和已装版本一致，否则手机只能卸载重装）' -ForegroundColor Yellow
}

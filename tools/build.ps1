# 本地构建 APK（使用 .toolchain 下的 JDK / Android SDK / Gradle，不依赖系统环境）
# 用法: powershell -ExecutionPolicy Bypass -File tools\build.ps1 [-Release] [-Toolchain <path>]
param(
  [switch]$Release,
  [string]$Project = (Split-Path -Parent $PSScriptRoot),
  [string]$Toolchain = ''
)

$ErrorActionPreference = 'Stop'

if (-not $Toolchain) {
  foreach ($c in @((Join-Path $Project '.toolchain'),
                   (Join-Path (Split-Path -Parent $Project) '.toolchain'))) {
    if (Test-Path $c) { $Toolchain = $c; break }
  }
}
if (-not $Toolchain -or -not (Test-Path $Toolchain)) {
  throw "找不到 .toolchain，请先运行 tools\setup-toolchain.ps1，或用 -Toolchain 指定路径"
}

$jdk = Join-Path $Toolchain 'jdk'
$sdk = Join-Path $Toolchain 'android-sdk'
$gradle = Join-Path $Toolchain 'gradle-8.7\bin\gradle.bat'

foreach ($p in @($jdk, $sdk, $gradle)) {
  if (-not (Test-Path $p)) { throw "缺少构建组件: $p（先运行 tools\setup-toolchain.ps1）" }
}

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:GRADLE_USER_HOME = Join-Path $Toolchain 'gradle-home'
$env:ANDROID_USER_HOME = Join-Path $Toolchain 'android-home'
$env:TEMP = Join-Path $Toolchain 'tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:GRADLE_USER_HOME, $env:ANDROID_USER_HOME, $env:TEMP | Out-Null
$env:Path = "$jdk\bin;" + $env:Path

# AGP 也可以通过 local.properties 找 SDK
"sdk.dir=" + ($sdk -replace '\\', '\\') | Set-Content -Path (Join-Path $Project 'local.properties') -Encoding ASCII

if ($Release) { $tasks = 'assembleRelease' } else { $tasks = 'assembleDebug' }
Write-Host "gradle $tasks (toolchain: $Toolchain)" -ForegroundColor Cyan

$log = Join-Path $Toolchain 'build.log'
& $gradle -p $Project --no-daemon --console=plain $tasks *> $log
$code = $LASTEXITCODE
Get-Content $log -Tail 25
if ($code -ne 0) { throw "构建失败（exit $code），完整日志: $log" }

Get-ChildItem (Join-Path $Project 'app\build\outputs\apk') -Recurse -Filter *.apk |
  Select-Object FullName, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 2) } } |
  Format-Table -AutoSize

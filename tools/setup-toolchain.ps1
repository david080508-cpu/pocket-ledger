# 一次性安装本地 Android 构建链（不污染系统，全部放在 .toolchain 下）
# 用法: powershell -ExecutionPolicy Bypass -File tools\setup-toolchain.ps1 -Root <workspace>
param(
  [Parameter(Mandatory = $true)][string]$Root
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$tc = Join-Path $Root '.toolchain'
$dl = Join-Path $tc 'dl'
$log = Join-Path $tc 'setup.log'
New-Item -ItemType Directory -Force -Path $tc, $dl, "$tc\tmp" | Out-Null
Set-Content -Path $log -Value "" -Encoding UTF8

function Log([string]$m) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m
  Write-Host $line
  Add-Content -Path $log -Value $line -Encoding UTF8
}

function Fetch([string]$Url, [string]$Out) {
  $f = Get-Item $Out -ErrorAction SilentlyContinue
  if ($f -and $f.Length -gt 1MB) { Log "skip $Out ($([math]::Round($f.Length/1MB,1)) MB)"; return }
  Log "GET $Url"
  & curl.exe -L --fail --retry 4 --retry-delay 3 --connect-timeout 25 --max-time 3600 -sS -o $Out $Url
  if ($LASTEXITCODE -ne 0) { throw "download failed: $Url (exit $LASTEXITCODE)" }
  Log ("OK {0} ({1} MB)" -f $Out, [math]::Round((Get-Item $Out).Length / 1MB, 1))
}

function Expand-Zip([string]$Zip, [string]$Dest) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  [System.IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Dest)
  Log "extracted $Zip -> $Dest"
}

# ---------- 1. JDK 17 ----------
$jdkZip = Join-Path $dl 'jdk17.zip'
Fetch 'https://mirrors.huaweicloud.com/openjdk/17.0.2/openjdk-17.0.2_windows-x64_bin.zip' $jdkZip
$jdkTmp = Join-Path $tc 'jdk-tmp'
Expand-Zip $jdkZip $jdkTmp
$jdkDir = Get-ChildItem $jdkTmp -Directory | Select-Object -First 1
$jdk = Join-Path $tc 'jdk'
if (Test-Path $jdk) { Remove-Item -Recurse -Force $jdk }
Move-Item $jdkDir.FullName $jdk
Remove-Item -Recurse -Force $jdkTmp
Log "JDK -> $jdk"

# ---------- 2. Android cmdline-tools ----------
$cmdZip = Join-Path $dl 'cmdline-tools.zip'
Fetch 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' $cmdZip
$sdk = Join-Path $tc 'android-sdk'
$cmdTmp = Join-Path $tc 'cmd-tmp'
Expand-Zip $cmdZip $cmdTmp
$latest = Join-Path $sdk 'cmdline-tools\latest'
if (Test-Path $latest) { Remove-Item -Recurse -Force $latest }
New-Item -ItemType Directory -Force -Path (Split-Path $latest) | Out-Null
Move-Item (Join-Path $cmdTmp 'cmdline-tools') $latest
Remove-Item -Recurse -Force $cmdTmp
Log "cmdline-tools -> $latest"

# ---------- 3. Gradle ----------
$gradleZip = Join-Path $dl 'gradle-8.7-bin.zip'
Fetch 'https://mirrors.cloud.tencent.com/gradle/gradle-8.7-bin.zip' $gradleZip
$gradleTmp = Join-Path $tc 'gradle-tmp'
Expand-Zip $gradleZip $gradleTmp
if (Test-Path (Join-Path $tc 'gradle-8.7')) { Remove-Item -Recurse -Force (Join-Path $tc 'gradle-8.7') }
Move-Item (Join-Path $gradleTmp 'gradle-8.7') (Join-Path $tc 'gradle-8.7')
Remove-Item -Recurse -Force $gradleTmp
$gradle = Join-Path $tc 'gradle-8.7'
Log "Gradle -> $gradle"

# ---------- 4. 环境变量 ----------
$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:GRADLE_USER_HOME = Join-Path $tc 'gradle-home'
$env:PATH = "$jdk\bin;$gradle\bin;" + $env:PATH
New-Item -ItemType Directory -Force -Path $env:GRADLE_USER_HOME | Out-Null

$envFile = @"
# 由 tools/setup-toolchain.ps1 生成
`$env:JAVA_HOME = '$jdk'
`$env:ANDROID_HOME = '$sdk'
`$env:ANDROID_SDK_ROOT = '$sdk'
`$env:GRADLE_USER_HOME = '$(Join-Path $tc 'gradle-home')'
`$env:GRADLE_BIN = '$gradle\bin'
`$env:PATH = "$jdk\bin;$gradle\bin;" + `$env:PATH
"@
Set-Content -Path (Join-Path $tc 'env.ps1') -Value $envFile -Encoding UTF8

# ---------- 5. 安装 SDK 组件 ----------
$sdkmanager = Join-Path $latest 'bin\sdkmanager.bat'
$yes = ((1..60) | ForEach-Object { 'y' }) -join "`r`n"
Log "accepting licenses"
$yes | & $sdkmanager --sdk_root=$sdk --licenses 2>&1 | Select-Object -Last 3 | ForEach-Object { Log $_ }

Log "installing platform-tools / platform 34 / build-tools 34.0.0"
& $sdkmanager --sdk_root=$sdk 'platform-tools' 'platforms;android-34' 'build-tools;34.0.0' 2>&1 |
  Select-Object -Last 5 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) { throw "sdkmanager install failed" }

# ---------- 6. Gradle wrapper（给仓库和 CI 用） ----------
$wrapDir = Join-Path $tc 'wrapgen'
New-Item -ItemType Directory -Force -Path $wrapDir | Out-Null
Log "generating gradle wrapper"
& (Join-Path $gradle 'bin\gradle.bat') -p $wrapDir wrapper --gradle-version 8.7 --distribution-type bin -q 2>&1 |
  ForEach-Object { Log $_ }
$wrapperTarget = Join-Path $Root 'pocket-ledger'
foreach ($item in 'gradlew', 'gradlew.bat', 'gradle\wrapper\gradle-wrapper.jar', 'gradle\wrapper\gradle-wrapper.properties') {
  $src = Join-Path $wrapDir $item
  $dst = Join-Path $wrapperTarget $item
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  Copy-Item $src $dst -Force
}
Log "wrapper copied to project"

Log ("java: " + (& "$jdk\bin\java.exe" -version 2>&1 | Select-Object -First 1))
Log ("adb/build-tools: " + (Test-Path (Join-Path $sdk 'build-tools\34.0.0\aapt2.exe')))
Log "SETUP DONE"

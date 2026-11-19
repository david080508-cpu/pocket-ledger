# Generates launcher / PWA icons with GDI+ (no extra tooling required).
param(
  [string]$Project = "$PSScriptRoot\.."
)

Add-Type -AssemblyName System.Drawing

function New-Icon {
  param([int]$Size, [string]$Out, [switch]$Round, [switch]$Transparent, [double]$GlyphScale = 0.52)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)

  if (-not $Transparent) {
    $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $c1 = [System.Drawing.Color]::FromArgb(255, 13, 148, 136)
    $c2 = [System.Drawing.Color]::FromArgb(255, 15, 118, 110)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 45.0)
    if ($Round) {
      $g.FillEllipse($brush, 0, 0, $Size - 1, $Size - 1)
    } else {
      $r = [int]($Size * 0.22)
      $path = New-Object System.Drawing.Drawing2D.GraphicsPath
      $d = $r * 2
      $path.AddArc(0, 0, $d, $d, 180, 90)
      $path.AddArc($Size - $d - 1, 0, $d, $d, 270, 90)
      $path.AddArc($Size - $d - 1, $Size - $d - 1, $d, $d, 0, 90)
      $path.AddArc(0, $Size - $d - 1, $d, $d, 90, 90)
      $path.CloseFigure()
      $g.FillPath($brush, $path)
      $path.Dispose()
    }
    $brush.Dispose()
  }

  $text = [char]0x00A5
  $fontSize = [float]($Size * $GlyphScale)
  $font = New-Object System.Drawing.Font("Microsoft YaHei", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $box = New-Object System.Drawing.RectangleF(0, 0, $Size, $Size)
  $g.DrawString([string]$text, $font, $white, $box, $fmt)

  $font.Dispose(); $white.Dispose(); $fmt.Dispose(); $g.Dispose()
  $dir = Split-Path -Parent $Out
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "wrote $Out ($Size px)"
}

$res = Join-Path $Project "app\src\main\res"
$densities = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }

foreach ($k in $densities.Keys) {
  $s = $densities[$k]
  New-Icon -Size $s -Out (Join-Path $res "mipmap-$k\ic_launcher.png")
  New-Icon -Size $s -Out (Join-Path $res "mipmap-$k\ic_launcher_round.png") -Round
}

# Adaptive icon foreground: white glyph on transparent, 432px (108dp @ 4x)
New-Icon -Size 432 -Out (Join-Path $res "drawable-nodpi\ic_launcher_foreground.png") -Transparent -GlyphScale 0.40

# PWA icons used by the bundled web app
$web = Join-Path $Project "app\src\main\assets\app\icons"
New-Icon -Size 192 -Out (Join-Path $web "icon-192.png")
New-Icon -Size 512 -Out (Join-Path $web "icon-512.png")

Write-Host "done"

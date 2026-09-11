$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root 'src-tauri/installer'
New-Item -ItemType Directory -Force $out | Out-Null
$icon = [System.Drawing.Image]::FromFile((Join-Path $root '20260904-151355.png'))
$fonts = [System.Drawing.Text.PrivateFontCollection]::new()
$fonts.AddFontFile((Join-Path $root 'public/fonts/zcool-happy-2016.ttf'))
$family = $fonts.Families[0]
Write-Output "Artwork font: $($family.Name)"

# Outline text uses the bundled font directly, without system installation or fallback.
function Draw-Label($g, [string]$text, [single]$size, [single]$x, [single]$y, [string]$color) {
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($color))
    try {
        $path.AddString($text, $family, 0, $size, [System.Drawing.PointF]::new($x, $y), [System.Drawing.StringFormat]::GenericTypographic)
        $g.FillPath($brush, $path)
    } finally { $path.Dispose(); $brush.Dispose() }
}

function Write-Art([string]$name, [int]$width, [int]$height, [bool]$sidebar) {
    $large = [System.Drawing.Bitmap]::new(($width * 4), ($height * 4), [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($large)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::White)
    $g.ScaleTransform(4, 4)
    try {
        if ($sidebar) {
            Draw-Label $g 'Flank' 30 18 17 '#23334D'
            Draw-Label $g '桌面便签 · 灵感随手记' 10 19 54 '#64748B'
            $g.DrawImage($icon, 2, 73, 160, 160)
            Draw-Label $g '来不及整理的，' 17 18 233 '#23334D'
            Draw-Label $g '先放在手边' 17 18 254 '#23334D'
            Draw-Label $g '无需账号 / 本地优先' 11 19 290 '#64748B'
        } else {
            $g.DrawImage($icon, 1, 2, 52, 52)
            Draw-Label $g 'Flank' 28 59 12 '#23334D'
        }
        $large.Save((Join-Path $out "$name@4x.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $smallG = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $smallG.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $smallG.DrawImage($large, 0, 0, $width, $height)
            $bmp.Save((Join-Path $out "$name.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
            $bmp.Save((Join-Path $out "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $smallG.Dispose(); $bmp.Dispose() }
    } finally { $g.Dispose(); $large.Dispose() }
}
try {
    Write-Art 'nsis-sidebar' 164 314 $true
    Write-Art 'nsis-header' 150 57 $false
} finally { $icon.Dispose(); $family.Dispose(); $fonts.Dispose() }

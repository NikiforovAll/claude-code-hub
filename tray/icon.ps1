function New-RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  $p
}

# public/icons/icon-192.svg redrawn at the tray's own size, with a status dot in place of the bottom-right tile.
function New-TrayBitmap([int]$size, [System.Drawing.Color]$status) {
  $k = $size / 192
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.PixelOffsetMode = 'Half'
  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(26, 26, 46))
  $path = New-RoundRect 0 0 $size $size (32 * $k)
  $g.FillPath($bg, $path)
  $path.Dispose()
  # Whole-pixel tiles and stroke keep the outlines sharp at 16 px.
  $stroke = [Math]::Max(1, [Math]::Round(6 * $k))
  $tile = [Math]::Round(40 * $k)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(233, 69, 96)), $stroke
  foreach ($pos in @(@(44, 44), @(108, 44), @(44, 108))) {
    $x = [Math]::Round($pos[0] * $k) + $stroke / 2
    $y = [Math]::Round($pos[1] * $k) + $stroke / 2
    $path = New-RoundRect $x $y ($tile - $stroke) ($tile - $stroke) ([Math]::Max(0.5, 6 * $k))
    $g.DrawPath($pen, $path)
    $path.Dispose()
  }
  $c = 128 * $k
  $dot = $size * 0.2
  $brush = New-Object System.Drawing.SolidBrush $status
  $g.FillEllipse($brush, $c - $dot, $c - $dot, 2 * $dot, 2 * $dot)
  $brush.Dispose()
  $pen.Dispose()
  $bg.Dispose()
  $g.Dispose()
  $bmp
}

$StateColors = @{
  running  = [System.Drawing.Color]::FromArgb(34, 197, 94)
  starting = [System.Drawing.Color]::FromArgb(245, 158, 11)
  stopped  = [System.Drawing.Color]::FromArgb(239, 68, 68)
}

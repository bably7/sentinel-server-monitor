param(
  [string]$SourcePath,
  [string]$OutputPath,
  [ValidateSet('jpeg', 'png')]
  [string]$Format
)

Add-Type -AssemblyName System.Drawing

try {
  $image = [System.Drawing.Image]::FromFile($SourcePath)
  try {
    if ($image.PropertyIdList -contains 0x0112) {
      $orientation = [BitConverter]::ToUInt16($image.GetPropertyItem(0x0112).Value, 0)
      $rotation = switch ($orientation) {
        2 { [System.Drawing.RotateFlipType]::RotateNoneFlipX }
        3 { [System.Drawing.RotateFlipType]::Rotate180FlipNone }
        4 { [System.Drawing.RotateFlipType]::Rotate180FlipX }
        5 { [System.Drawing.RotateFlipType]::Rotate90FlipX }
        6 { [System.Drawing.RotateFlipType]::Rotate90FlipNone }
        7 { [System.Drawing.RotateFlipType]::Rotate270FlipX }
        8 { [System.Drawing.RotateFlipType]::Rotate270FlipNone }
        default { [System.Drawing.RotateFlipType]::RotateNoneFlipNone }
      }
      $image.RotateFlip($rotation)
    }

    $scale = [Math]::Min(1.0, [Math]::Min(2560.0 / $image.Width, 1440.0 / $image.Height))
    $width = [Math]::Max(1, [int][Math]::Round($image.Width * $scale))
    $height = [Math]::Max(1, [int][Math]::Round($image.Height * $scale))
    $pixelFormat = if ($Format -eq 'png') {
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    } else {
      [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
    }
    $output = [System.Drawing.Bitmap]::new($width, $height, $pixelFormat)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($output)
      try {
        if ($Format -eq 'png') {
          $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
          $graphics.Clear([System.Drawing.Color]::Transparent)
        } else {
          $graphics.Clear([System.Drawing.Color]::Black)
        }
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.DrawImage($image, 0, 0, $width, $height)
      } finally {
        $graphics.Dispose()
      }

      if ($Format -eq 'png') {
        $output.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
      } else {
        $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
          Where-Object { $_.MimeType -eq 'image/jpeg' } |
          Select-Object -First 1
        $parameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
        try {
          $parameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new(
            [System.Drawing.Imaging.Encoder]::Quality,
            [long]90
          )
          $output.Save($OutputPath, $encoder, $parameters)
        } finally {
          $parameters.Dispose()
        }
      }
    } finally {
      $output.Dispose()
    }
  } finally {
    $image.Dispose()
  }
} catch {
  Write-Error $_
  exit 1
}

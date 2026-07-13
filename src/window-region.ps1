param(
  [long]$Handle,
  [int]$Radius,
  [int]$Clear
)

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class SentinelWindowRegion
{
    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out RECT rect);

    [DllImport("user32.dll")]
    private static extern int SetWindowRgn(IntPtr window, IntPtr region, bool redraw);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int ellipseWidth, int ellipseHeight);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr value);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);

    [StructLayout(LayoutKind.Sequential)]
    private struct DWM_BLURBEHIND
    {
        public uint Flags;
        public bool Enable;
        public IntPtr BlurRegion;
        public bool TransitionOnMaximized;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmEnableBlurBehindWindow(IntPtr window, ref DWM_BLURBEHIND blur);

    public static void Apply(long rawHandle, int radius, bool clear)
    {
        IntPtr window = new IntPtr(rawHandle);
        // The Win32 region owns the shape; disable DWM's extra rounded border,
        // which otherwise paints a rectangular corner pixel on transparent windows.
        int roundedCornerPreference = 1;
        DwmSetWindowAttribute(window, 33, ref roundedCornerPreference, sizeof(int));
        int borderColor = -2; // DWMWA_COLOR_NONE
        DwmSetWindowAttribute(window, 34, ref borderColor, sizeof(int));

        if (clear)
        {
            DWM_BLURBEHIND fullBlur = new DWM_BLURBEHIND
            {
                Flags = 1,
                Enable = true,
                BlurRegion = IntPtr.Zero,
                TransitionOnMaximized = false
            };
            DwmEnableBlurBehindWindow(window, ref fullBlur);
            SetWindowRgn(window, IntPtr.Zero, true);
            return;
        }

        RECT rect;
        if (!GetWindowRect(window, out rect)) return;
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        int diameter = Math.Max(2, radius * 2);
        IntPtr region = CreateRoundRectRgn(2, 2, width - 1, height - 1, diameter, diameter);
        if (region == IntPtr.Zero) return;
        // DWM expands blur by one antialiasing pixel; inset its region so it
        // never paints beyond the Win32 window shape at the extreme corners.
        IntPtr blurRegion = CreateRoundRectRgn(6, 6, width - 5, height - 5, diameter, diameter);
        if (blurRegion != IntPtr.Zero)
        {
            DWM_BLURBEHIND roundedBlur = new DWM_BLURBEHIND
            {
                Flags = 3,
                Enable = true,
                BlurRegion = blurRegion,
                TransitionOnMaximized = false
            };
            DwmEnableBlurBehindWindow(window, ref roundedBlur);
            DeleteObject(blurRegion);
        }
        if (SetWindowRgn(window, region, true) == 0) DeleteObject(region);
    }
}
'@

[SentinelWindowRegion]::Apply($Handle, $Radius, $Clear -eq 1)

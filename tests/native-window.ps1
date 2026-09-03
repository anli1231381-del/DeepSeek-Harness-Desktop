param([int]$TargetPid, [string]$Screenshot = '', [switch]$Close)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class NativeViewCheck {
  public delegate bool Visitor(IntPtr window, IntPtr param);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(Visitor visitor, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, Visitor visitor, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder text, int length);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr context, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
}
'@
[NativeViewCheck]::SetProcessDPIAware() | Out-Null
$windows = [Collections.Generic.List[object]]::new()
$collect = [NativeViewCheck+Visitor]{ param($handle, $unused)
  [uint32]$owner = 0
  [NativeViewCheck]::GetWindowThreadProcessId($handle, [ref]$owner) | Out-Null
  if ($owner -ne $TargetPid) { return $true }
  $title=[Text.StringBuilder]::new(256); $class=[Text.StringBuilder]::new(256)
  [NativeViewCheck]::GetWindowText($handle,$title,256) | Out-Null
  [NativeViewCheck]::GetClassName($handle,$class,256) | Out-Null
  $rect=[NativeViewCheck+Rect]::new(); [NativeViewCheck]::GetWindowRect($handle,[ref]$rect) | Out-Null
  $windows.Add([pscustomobject]@{ id=$handle.ToInt64(); title=$title.ToString(); class=$class.ToString(); visible=[NativeViewCheck]::IsWindowVisible($handle); x=$rect.Left; y=$rect.Top; width=$rect.Right-$rect.Left; height=$rect.Bottom-$rect.Top })
  return $true
}
[NativeViewCheck]::EnumWindows($collect,[IntPtr]::Zero) | Out-Null
$main=$windows | Where-Object { $_.class -eq 'Tauri Window' } | Select-Object -First 1
if (!$main) { throw 'Desktop test window not found' }
if ($Close) { [NativeViewCheck]::PostMessage([IntPtr]$main.id,0x0010,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null; return }
[NativeViewCheck]::EnumChildWindows([IntPtr]$main.id,$collect,[IntPtr]::Zero) | Out-Null
if ($Screenshot) {
  Add-Type -AssemblyName System.Drawing
  $bitmap=[Drawing.Bitmap]::new($main.width,$main.height)
  $graphics=[Drawing.Graphics]::FromImage($bitmap); $context=$graphics.GetHdc()
  try { [NativeViewCheck]::PrintWindow([IntPtr]$main.id,$context,2) | Out-Null }
  finally { $graphics.ReleaseHdc($context); $graphics.Dispose() }
  try { $bitmap.Save($Screenshot,[Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
}
ConvertTo-Json -InputObject @($windows.ToArray()) -Compress

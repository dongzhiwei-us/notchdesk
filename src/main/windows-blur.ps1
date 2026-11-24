param([long]$WindowHandle, [int]$Enabled)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NotchBackdrop {
  [StructLayout(LayoutKind.Sequential)] struct Accent { public int State, Flags, Color, Animation; }
  [StructLayout(LayoutKind.Sequential)] struct Attribute { public int Id; public IntPtr Data; public int Size; }
  [DllImport("user32.dll")] static extern int SetWindowCompositionAttribute(IntPtr window, ref Attribute data);
  public static void Set(long window, bool enabled) {
    var accent = new Accent { State = enabled ? 3 : 0 };
    var memory = Marshal.AllocHGlobal(Marshal.SizeOf(accent));
    try {
      Marshal.StructureToPtr(accent, memory, false);
      var attribute = new Attribute { Id = 19, Data = memory, Size = Marshal.SizeOf(accent) };
      SetWindowCompositionAttribute(new IntPtr(window), ref attribute);
    } finally { Marshal.FreeHGlobal(memory); }
  }
}
'@
[NotchBackdrop]::Set($WindowHandle, $Enabled -eq 1)

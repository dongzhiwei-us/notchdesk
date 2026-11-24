param([int]$ParentProcessId)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.dll,System.Windows.Forms.dll -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class NotchFocus {
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
  delegate IntPtr MouseProc(int code, IntPtr message, IntPtr data);
  delegate void FocusProc(IntPtr hook, uint evt, IntPtr window, int obj, int child, uint thread, uint time);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int id, MouseProc proc, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, FocusProc proc, uint process, uint thread, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string module);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  static MouseProc mouse = OnMouse;
  static FocusProc focus = OnFocus;
  static IntPtr mouseHook, focusHook;
  static void Send(string value) { Console.Out.WriteLine(value); Console.Out.Flush(); }
  static IntPtr OnMouse(int code, IntPtr message, IntPtr data) {
    if (code >= 0) {
      long kind = message.ToInt64();
      if (kind == 0x201 || kind == 0x204) {
        var point = new Point { X = Marshal.ReadInt32(data), Y = Marshal.ReadInt32(data,4) };
        uint process; GetWindowThreadProcessId(WindowFromPoint(point), out process);
        Send("{\"type\":\"click\",\"x\":" + point.X + ",\"y\":" + point.Y + ",\"processId\":" + process + "}");
      }
      if (kind == 0x202) Send("{\"type\":\"release\"}");
    }
    return CallNextHookEx(mouseHook, code, message, data);
  }
  static void OnFocus(IntPtr hook, uint evt, IntPtr window, int obj, int child, uint thread, uint time) {
    if (window != GetForegroundWindow()) return;
    uint process; GetWindowThreadProcessId(window, out process);
    Send("{\"type\":\"focus\",\"handle\":\"" + window.ToInt64() + "\",\"processId\":" + process + "}");
  }
  public static void Run(int parent) {
    using (var owner = Process.GetProcessById(parent))
    using (var timer = new Timer()) {
      mouseHook = SetWindowsHookEx(14, mouse, GetModuleHandle(null), 0);
      focusHook = SetWinEventHook(3, 3, IntPtr.Zero, focus, 0, 0, 0);
      if (mouseHook == IntPtr.Zero || focusHook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      timer.Interval = 500;
      timer.Tick += delegate { if (owner.HasExited) Application.ExitThread(); };
      timer.Start();
      try { Send("{\"type\":\"ready\"}"); Application.Run(); }
      finally { UnhookWindowsHookEx(mouseHook); UnhookWinEvent(focusHook); }
    }
  }
}
'@
[NotchFocus]::Run($ParentProcessId)

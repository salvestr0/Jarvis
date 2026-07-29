// Pops a topmost "Jarvis" message box on the desktop — the Telegram → PC
// direction. The text arrives as a single process argument and is only ever
// rendered, never interpreted: no shell, no parsing, nothing to inject into.
//
// Compiled on first use by actions.mjs (see mediakey.cs for why a compiled
// helper and not PowerShell). Launched detached so the box can wait for a
// click without holding the job open.
using System;
using System.Runtime.InteropServices;

static class Notify
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    const uint MB_OK = 0x0;
    const uint MB_ICONINFORMATION = 0x40;
    const uint MB_SETFOREGROUND = 0x10000;
    const uint MB_TOPMOST = 0x40000;

    static int Main(string[] args)
    {
        if (args.Length != 1 || args[0].Length == 0) return 2;
        MessageBoxW(IntPtr.Zero, args[0], "Jarvis",
            MB_OK | MB_ICONINFORMATION | MB_SETFOREGROUND | MB_TOPMOST);
        return 0;
    }
}

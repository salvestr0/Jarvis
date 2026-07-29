// Presses a hardware media key (play/pause, next, previous). Windows routes
// it to the active media session (Spotify, browser, whatever), exactly like
// the key on a keyboard — no app-specific API needed.
//
// Compiled on first use by actions.mjs with the .NET Framework csc.exe, same
// as screenshot.cs: a compiled helper is the boring path that Defender's
// AMSI has no opinion about. winexe target so no console window flashes.
using System;
using System.Runtime.InteropServices;

static class MediaKey
{
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    const uint KEYEVENTF_KEYUP = 0x0002;

    static int Main(string[] args)
    {
        if (args.Length != 1) return 2;

        byte vk;
        switch (args[0])
        {
            case "play_pause": vk = 0xB3; break; // VK_MEDIA_PLAY_PAUSE
            case "next":       vk = 0xB0; break; // VK_MEDIA_NEXT_TRACK
            case "prev":       vk = 0xB1; break; // VK_MEDIA_PREV_TRACK
            default: return 2;
        }

        keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, UIntPtr.Zero);
        keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, UIntPtr.Zero);
        return 0;
    }
}

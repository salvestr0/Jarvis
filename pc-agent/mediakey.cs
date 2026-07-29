// Presses a hardware media/volume key (play/pause, next, previous, volume,
// mute). Windows routes it exactly like the key on a keyboard — media keys
// go to the active media session, volume keys to the system mixer.
//
// Optional second argument repeats the press (volume moves 2/100 per press,
// so "turn it down" presses several times). Capped so a bad call can't
// max out the volume.
//
// Compiled on first use by actions.mjs with the .NET Framework csc.exe, same
// as screenshot.cs: a compiled helper is the boring path that Defender's
// AMSI has no opinion about. winexe target so no console window flashes.
using System;
using System.Runtime.InteropServices;
using System.Threading;

static class MediaKey
{
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    const uint KEYEVENTF_KEYUP = 0x0002;

    static int Main(string[] args)
    {
        if (args.Length < 1 || args.Length > 2) return 2;

        byte vk;
        switch (args[0])
        {
            case "play_pause":  vk = 0xB3; break; // VK_MEDIA_PLAY_PAUSE
            case "next":        vk = 0xB0; break; // VK_MEDIA_NEXT_TRACK
            case "prev":        vk = 0xB1; break; // VK_MEDIA_PREV_TRACK
            case "volume_up":   vk = 0xAF; break; // VK_VOLUME_UP
            case "volume_down": vk = 0xAE; break; // VK_VOLUME_DOWN
            case "mute":        vk = 0xAD; break; // VK_VOLUME_MUTE
            default: return 2;
        }

        int count = 1;
        if (args.Length == 2 && (!int.TryParse(args[1], out count) || count < 1 || count > 10))
            return 2;

        for (int i = 0; i < count; i++)
        {
            keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, UIntPtr.Zero);
            keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, UIntPtr.Zero);
            if (count > 1) Thread.Sleep(30);
        }
        return 0;
    }
}

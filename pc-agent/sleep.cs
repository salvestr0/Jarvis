// Puts the PC to sleep (S3 suspend, not hibernate) via powrprof's
// SetSuspendState. The obvious PowerShell one-liner making the same call
// silently no-ops when its process is spawned detached (which is how
// launch() runs argv actions) — the request never reaches the kernel —
// so sleep is this compiled helper, spawned attached by its builtin in
// actions.mjs.
//
// Exit 0 on success. On failure the exit code is the Win32 error, so the
// job result carries something diagnosable instead of a silent "done".
//
// Compiled on first use by actions.mjs with the .NET Framework csc.exe,
// winexe target so no console window flashes.
using System.Runtime.InteropServices;

static class SleepPc
{
    [DllImport("powrprof.dll", SetLastError = true)]
    static extern bool SetSuspendState(bool hibernate, bool force, bool disableWakeEvent);

    static int Main()
    {
        // hibernate:false = S3 sleep; the call blocks until the PC resumes.
        if (SetSuspendState(false, false, false)) return 0;
        int err = Marshal.GetLastWin32Error();
        return err == 0 ? 1 : err;
    }
}

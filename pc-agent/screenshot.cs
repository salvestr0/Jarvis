// Capture the full virtual screen, scale to max 1600px wide, save as JPEG.
// Compiled on first use by actions.mjs with the .NET Framework csc.exe that
// ships in Windows (a script version trips Defender's AMSI heuristics; a
// plain compiled helper is the boring, supported path).
//
// Usage: screenshot.exe <output.jpg>

using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Linq;
using System.Windows.Forms;

static class Screenshot
{
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length != 1) { Console.Error.WriteLine("usage: screenshot.exe <out.jpg>"); return 2; }

        Rectangle bounds = SystemInformation.VirtualScreen;
        using (var bmp = new Bitmap(bounds.Width, bounds.Height))
        {
            using (var g = Graphics.FromImage(bmp))
                g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);

            double scale = Math.Min(1.0, 1600.0 / bounds.Width);
            Bitmap output = scale < 1.0
                ? new Bitmap(bmp, new Size((int)(bounds.Width * scale), (int)(bounds.Height * scale)))
                : bmp;

            ImageCodecInfo jpeg = ImageCodecInfo.GetImageEncoders()
                .First(c => c.MimeType == "image/jpeg");
            var prms = new EncoderParameters(1);
            prms.Param[0] = new EncoderParameter(Encoder.Quality, 70L);
            output.Save(args[0], jpeg, prms);
            if (!ReferenceEquals(output, bmp)) output.Dispose();
        }
        return 0;
    }
}

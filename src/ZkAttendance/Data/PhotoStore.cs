using System.Drawing.Imaging;

namespace ZkAttendance.Data;

/// <summary>
/// Employee photos are kept in the database as base64 text (Employees.PhotoBase64): a JPEG shrunk to at most
/// 300 px, so a photo is roughly 15-40 KB of text.
/// </summary>
public static class PhotoStore
{
    public const int MaxSide = 300;

    /// <summary>Resizes the image and returns it as base64 JPEG text.</summary>
    public static string Encode(Image src)
    {
        double scale = Math.Min(1.0, (double)MaxSide / Math.Max(src.Width, src.Height));
        using var bmp = new Bitmap(src, new Size(Math.Max(1, (int)(src.Width * scale)), Math.Max(1, (int)(src.Height * scale))));
        using var ms = new MemoryStream();
        bmp.Save(ms, ImageFormat.Jpeg);
        return Convert.ToBase64String(ms.ToArray());
    }

    /// <summary>Image from base64 text; null when empty or not a valid picture.</summary>
    public static Image? Decode(string? base64)
    {
        if (string.IsNullOrWhiteSpace(base64)) return null;
        try
        {
            var bytes = Convert.FromBase64String(base64);
            using var ms = new MemoryStream(bytes);
            // Copy into a Bitmap so the stream can be closed (GDI+ otherwise needs it open for the image's lifetime).
            using var img = Image.FromStream(ms);
            return new Bitmap(img);
        }
        catch { return null; }
    }

    /// <summary>Small copy for grid rows.</summary>
    public static Image? Thumbnail(string? base64, int height)
    {
        using var img = Decode(base64);
        if (img == null) return null;
        int width = Math.Max(1, img.Width * height / img.Height);
        return new Bitmap(img, new Size(width, height));
    }
}

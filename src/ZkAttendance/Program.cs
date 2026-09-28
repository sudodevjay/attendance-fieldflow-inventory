using ZkAttendance.Data;
using ZkAttendance.UI;

namespace ZkAttendance;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.ThreadException += (_, e) => Ui.Error(e.Exception);

        DbConfig.Load();
        while (true)
        {
            try
            {
                AppDbContext.Initialize();
                break;
            }
            catch (Exception ex)
            {
                var retry = MessageBox.Show(
                    $"SQL Server database se connect nahi ho paya:\n\n{ex.GetBaseException().Message}\n\n" +
                    $"Connection string:\n{DbConfig.ConnectionString}\n\n" +
                    "Yes = connection string badlein, No = band karein",
                    "Database", MessageBoxButtons.YesNo, MessageBoxIcon.Error);
                if (retry != DialogResult.Yes) return;

                var dlg = new FormDialog("SQL Server Connection", 620);
                var cs = dlg.AddText("Connection string", DbConfig.ConnectionString);
                dlg.AddNote(@"Example: Server=.\SQLEXPRESS;Database=ZkAttendance;Trusted_Connection=True;TrustServerCertificate=True");
                if (dlg.ShowDialog() != DialogResult.OK) return;
                DbConfig.ConnectionString = cs.Text.Trim();
                DbConfig.Save();
            }
        }

        if (!AdminDialog.Login()) return;

        var form = new MainForm();
        // Auto-sync downloads on start by itself; this older option only matters when auto-sync is off.
        if (AppDbContext.GetSetting("AutoDownload") == "1" && AutoSync.Minutes == 0)
            form.Shown += async (_, _) =>
            {
                foreach (var p in DeviceActions.All())
                {
                    try { await DeviceActions.DownloadAttendance(p); }
                    catch { /* device may be unplugged; user can download manually */ }
                }
            };
        Application.Run(form);
    }
}

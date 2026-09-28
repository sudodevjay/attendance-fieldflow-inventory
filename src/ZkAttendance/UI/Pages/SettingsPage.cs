using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using ZkAttendance.Data;
using ZkAttendance.Device;

namespace ZkAttendance.UI.Pages;

public class SettingsPage : PageBase
{
    public override string Title => "Settings";

    private readonly TextBox _company = new() { Width = 420 };
    private readonly TextBox _address = new() { Width = 420, Multiline = true, Height = 60 };
    private readonly TextBox _conn = new() { Width = 620 };
    private readonly CheckBox _admsEnabled = new() { Text = "ADMS (Push / Cloud) server chalayein - naye ZKTeco devices khud is PC par attendance bhejenge", AutoSize = true };
    private readonly NumericUpDown _admsPort = new() { Minimum = 1, Maximum = 65535, Value = 8081, Width = 90 };
    private readonly CheckBox _autoDownload = new() { Text = "App start hone par device se attendance auto-download karein", AutoSize = true };
    private readonly NumericUpDown _syncMinutes = new() { Minimum = 0, Maximum = 1440, Value = AutoSync.DefaultMinutes, Width = 70 };

    public SettingsPage()
    {
        var f = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, BackColor = Theme.Card };

        f.Controls.Add(Ui.Label("Company (reports ke header me aayega)", Theme.Title));
        f.Controls.Add(Ui.Label("Company name", color: Theme.Muted));
        f.Controls.Add(_company);
        f.Controls.Add(Ui.Label("Address", color: Theme.Muted));
        f.Controls.Add(_address);
        f.Controls.Add(_autoDownload);
        var syncRow = new FlowLayoutPanel { AutoSize = true };
        syncRow.Controls.Add(Ui.Label("Auto-sync: har"));
        syncRow.Controls.Add(_syncMinutes);
        syncRow.Controls.Add(Ui.Label("minute me device se naye punch / users download karein (0 = band)"));
        f.Controls.Add(syncRow);
        f.Controls.Add(Ui.Button("Save", (_, _) => SaveCompany(), ButtonStyle.Primary));

        f.Controls.Add(new Label { Height = 20 });
        f.Controls.Add(Ui.Label("ADMS Server (Push devices)", Theme.Title));
        f.Controls.Add(_admsEnabled);
        var admsRow = new FlowLayoutPanel { AutoSize = true };
        admsRow.Controls.Add(Ui.Label("Port"));
        admsRow.Controls.Add(_admsPort);
        admsRow.Controls.Add(Ui.Button("Save / Restart ADMS", (_, _) => SaveAdms()));
        f.Controls.Add(admsRow);
        f.Controls.Add(Ui.Label("Device menu → Comm → Cloud Server Setting: Server = is PC ka IP, Port = upar wala port. Windows Firewall me port allow karein.", color: Theme.Muted));

        f.Controls.Add(new Label { Height = 20 });
        f.Controls.Add(Ui.Label("Database (SQL Server)", Theme.Title));
        f.Controls.Add(Ui.Label("Connection string", color: Theme.Muted));
        f.Controls.Add(_conn);
        var row = new FlowLayoutPanel { AutoSize = true };
        row.Controls.Add(Ui.Button("Test Connection", (_, _) => Test()));
        row.Controls.Add(Ui.Button("Save (restart required)", (_, _) => SaveConn()));
        row.Controls.Add(Ui.Button("Backup Database", (_, _) => BackupDatabase(this)));
        f.Controls.Add(row);
        f.Controls.Add(Ui.Label("Backup file SQL Server machine par save hoti hai (SQL service ko us folder me write permission chahiye).", color: Theme.Muted));

        foreach (Control c in f.Controls) c.Margin = new Padding(0, 4, 0, 4);
        Body.Controls.Add(Ui.Card(f, new Padding(20)));
    }

    public override void OnActivated()
    {
        _company.Text = AppDbContext.GetSetting("CompanyName", "My Company");
        _address.Text = AppDbContext.GetSetting("CompanyAddress");
        _autoDownload.Checked = AppDbContext.GetSetting("AutoDownload") == "1";
        _syncMinutes.Value = AutoSync.Minutes;
        _conn.Text = DbConfig.ConnectionString;
        _admsEnabled.Checked = AdmsHost.Enabled;
        _admsPort.Value = AdmsHost.ConfiguredPort;
    }

    private void SaveCompany()
    {
        try
        {
            AppDbContext.SetSetting("CompanyName", _company.Text.Trim());
            AppDbContext.SetSetting("CompanyAddress", _address.Text.Trim());
            AppDbContext.SetSetting("AutoDownload", _autoDownload.Checked ? "1" : "0");
            AppDbContext.SetSetting("AutoSync.Minutes", ((int)_syncMinutes.Value).ToString());
            AutoSync.Apply();
            Ui.Info("Settings saved.");
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void SaveAdms()
    {
        try
        {
            AppDbContext.SetSetting("Adms.Enabled", _admsEnabled.Checked ? "1" : "0");
            AppDbContext.SetSetting("Adms.Port", ((int)_admsPort.Value).ToString());
            if (_admsEnabled.Checked)
            {
                AdmsHost.Start((int)_admsPort.Value);
                var ips = System.Net.Dns.GetHostAddresses(System.Net.Dns.GetHostName())
                    .Where(a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork).Select(a => a.ToString());
                Ui.Info($"ADMS server port {(int)_admsPort.Value} par chal raha hai.\n\nDevice me Server Address: {string.Join(" / ", ips)}\nPort: {(int)_admsPort.Value}");
            }
            else
            {
                AdmsServer.Stop();
                Ui.Info("ADMS server band kar diya.");
            }
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void Test()
    {
        try
        {
            using var c = new SqlConnection(_conn.Text);
            c.Open();
            Ui.Info($"Connection OK. Server: {c.DataSource}, Version {c.ServerVersion}");
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void SaveConn()
    {
        DbConfig.ConnectionString = _conn.Text.Trim();
        DbConfig.Save();
        Ui.Info("Saved. Software band karke dobara kholein.");
    }

    public static void BackupDatabase(IWin32Window owner)
    {
        var path = Ui.SaveFile("SQL Backup (*.bak)|*.bak", $"ZkAttendance_{DateTime.Now:yyyyMMdd_HHmm}.bak");
        if (path == null) return;
        try
        {
            using var db = new AppDbContext();
            var name = db.Database.GetDbConnection().Database;
            db.Database.SetCommandTimeout(600);
            // Database name can't be a parameter; it is bracket-escaped. The path is passed as a parameter.
#pragma warning disable EF1002
            db.Database.ExecuteSqlRaw($"BACKUP DATABASE [{name.Replace("]", "]]")}] TO DISK = {{0}} WITH INIT", path);
#pragma warning restore EF1002
            Ui.Info("Backup complete: " + path);
        }
        catch (Exception ex) { Ui.Error(ex); }
    }
}

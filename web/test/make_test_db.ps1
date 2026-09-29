# Copies the ZkAttendance database to ZkAttendanceTest for the end-to-end tests (the real database is not changed).
#   powershell -ExecutionPolicy Bypass -File web\test\make_test_db.ps1
#   python web\test\e2e_api.py ; python web\test\e2e_pi.py
#   powershell -ExecutionPolicy Bypass -File web\test\make_test_db.ps1 -Drop
param([switch]$Drop)
$ErrorActionPreference = 'Stop'
if ($Drop) {
    sqlcmd -S .\SQLEXPRESS -E -C -Q "IF DB_ID('ZkAttendanceTest') IS NOT NULL BEGIN ALTER DATABASE ZkAttendanceTest SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ZkAttendanceTest; END" -b
    'ZkAttendanceTest dropped.'
    return
}
$q = @'
SET NOCOUNT ON;
BACKUP DATABASE ZkAttendance TO DISK = 'ZkAttendance_webtest.bak' WITH INIT, COPY_ONLY;
DECLARE @dir nvarchar(400) = CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(400));
DECLARE @d nvarchar(128), @l nvarchar(128);
SELECT @d = name FROM ZkAttendance.sys.database_files WHERE type = 0;
SELECT @l = name FROM ZkAttendance.sys.database_files WHERE type = 1;
DECLARE @sql nvarchar(max) = N'RESTORE DATABASE ZkAttendanceTest FROM DISK = ''ZkAttendance_webtest.bak'' WITH REPLACE, MOVE ''' + @d + ''' TO ''' + @dir + 'ZkAttendanceTest.mdf'', MOVE ''' + @l + ''' TO ''' + @dir + 'ZkAttendanceTest_log.ldf''';
EXEC (@sql);
'@
sqlcmd -S .\SQLEXPRESS -E -C -Q $q -b
'ZkAttendanceTest created from ZkAttendance.'

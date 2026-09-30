# Creates the PostgreSQL test database zkattendance_test (Docker container zk-pg, port 5433) and copies the Windows
# program's SQL Server data into it (SQL Server is only read, nothing there changes).
#   powershell -ExecutionPolicy Bypass -File web\test\make_test_db.ps1
#   python web\test\e2e_api.py ; python web\test\e2e_pi.py ; python web\test\e2e_portal.py ; python web\test\e2e_hr.py
#   powershell -ExecutionPolicy Bypass -File web\test\make_test_db.ps1 -Drop
# Other PostgreSQL: set ZK_TEST_DATABASE_URL (tests and this script use it).
param([switch]$Drop)
$ErrorActionPreference = 'Stop'
$url = if ($env:ZK_TEST_DATABASE_URL) { $env:ZK_TEST_DATABASE_URL } else { 'postgresql://postgres:zkpass@localhost:5433/zkattendance_test' }

if (-not $env:ZK_TEST_DATABASE_URL) {
    if (-not (docker ps -a --filter name=^zk-pg$ --format '{{.Names}}')) {
        docker run -d --name zk-pg -e POSTGRES_PASSWORD=zkpass -e POSTGRES_DB=zkattendance -p 127.0.0.1:5433:5432 postgres:17 | Out-Null
        Start-Sleep 5
    } else { docker start zk-pg | Out-Null; Start-Sleep 2 }
    docker exec zk-pg psql -U postgres -q -c 'DROP DATABASE IF EXISTS zkattendance_test WITH (FORCE)'
    if ($Drop) { 'zkattendance_test dropped.'; return }
    docker exec zk-pg psql -U postgres -q -c 'CREATE DATABASE zkattendance_test'
}

$env:DATABASE_URL = $url
Push-Location (Join-Path $PSScriptRoot '..\server')
try { npx tsx scripts/copy-from-sqlserver.ts --yes } finally { Pop-Location }
'zkattendance_test created from ZkAttendance.'

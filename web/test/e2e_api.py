"""End-to-end test of the web API writes on a test PostgreSQL database (make_test_db.ps1).

    python web/test/e2e_api.py

Departments, shifts, schedule, employees (save, rename AC No, Excel export -> import), manual punch, pendrive import,
leave with quota warning / approve, holidays, rules, every report as grid / Excel / PDF, salary slip.
"""
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from datetime import date

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = 4002
BASE = f'http://localhost:{PORT}/api'
CS = os.environ.get('ZK_TEST_DATABASE_URL', 'postgresql://postgres:zkpass@localhost:5433/zkattendance_test')


def call(method, path, body=None, raw=False):
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
            return data if raw else json.loads(data)
    except urllib.error.HTTPError as e:
        return {'error': json.loads(e.read()).get('error'), 'status': e.code}


def upload(path, name, content: bytes):
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'
            ).encode() + content + f'\r\n--{b}--\r\n'.encode()
    req = urllib.request.Request(BASE + path, method='POST', data=body, headers={'Content-Type': f'multipart/form-data; boundary={b}'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def check(cond, what):
    print(('PASS ' if cond else 'FAIL ') + what)
    if not cond:
        raise SystemExit(1)


def main():
    env = dict(os.environ, PORT=str(PORT), DATABASE_URL=CS, TZ='Asia/Kolkata')
    server = subprocess.Popen('npx tsx src/server.ts', cwd=os.path.join(ROOT, 'web', 'server'), env=env, shell=True,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(60):
            try:
                call('GET', '/auth/status')
                break
            except Exception:
                time.sleep(0.5)

        # departments
        a = call('POST', '/departments', {'name': 'E2E Parent'})['id']
        b = call('POST', '/departments', {'name': 'E2E Child', 'parentId': a})['id']
        check(call('PUT', f'/departments/{a}', {'parentId': b}).get('status') == 400, 'cannot move a department under its own child')
        check(call('DELETE', f'/departments/{a}').get('status') == 400, 'cannot delete a department that has sub-departments')

        # shifts + schedule
        s = call('POST', '/shifts', {'Name': 'E2E Night', 'Start': '22:00', 'End': '06:00', 'LateGraceMinutes': 5, 'EarlyGraceMinutes': 5,
                                     'HalfDayMinutes': 240, 'MinOvertimeMinutes': 30, 'WeeklyOffs': ['Sunday', 'Saturday']})['id']
        sh = next(x for x in call('GET', '/shifts') if x['Id'] == s)
        check(sh['Hours'] == '08:00' and sh['WeeklyOffs'] == 'Sunday,Saturday', 'night shift 22:00-06:00 = 8 hours')

        # employee: save, AC No validation, rename moves punches
        check(call('POST', '/employees', {'EnrollNo': 'abc', 'Name': 'X'}).get('status') == 400, 'non-numeric AC No refused')
        e = call('POST', '/employees', {'EnrollNo': '950', 'Name': 'E2E Worker', 'DepartmentId': b, 'ShiftId': s, 'MonthlySalary': 30000,
                                        'JoinDate': '2026-01-01', 'IsActive': True})['id']
        check(call('POST', '/employees', {'EnrollNo': '950', 'Name': 'Dup'}).get('status') == 400, 'duplicate AC No refused')
        call('POST', '/schedule', {'ids': [e], 'shiftId': s})
        check(call('POST', '/logs/manual', {'employeeId': e, 'time': '2026-09-01 22:10:00', 'remark': 'e2e'}).get('ok'), 'manual punch')
        check(call('POST', '/logs/manual', {'employeeId': e, 'time': '2026-09-01 22:10:00'}).get('status') == 400, 'duplicate manual punch refused')
        imp = upload('/logs/import', '1_attlog.dat', b'950\t2026-09-02 06:05:00\t1\t1\t1\t0\r\n0950\t2026-09-02 06:05:00\t1\t1\t1\t0\r\nbad line\r\n')
        check('New: 1' in imp['message'], 'pendrive import (1 new, duplicate ignored): ' + imp['message'].replace('\n', ' '))
        detail = call('GET', f'/employees/{e}')
        call('PUT', f'/employees/{e}', {**detail, 'EnrollNo': '951', 'Admin': False})
        logs = call('GET', '/logs?from=2026-09-01&to=2026-09-02')['rows']
        check(sum(1 for r in logs if r['EnrollNo'] == '951') == 2, 'changing AC No moved its punches')

        # night shift attendance: 22:10 -> 06:05 next morning, late 10 min (grace 5)
        daily = call('GET', f'/reports/run?kind=DailyAttendance&from=2026-09-01&emp={e}')
        row = daily['rows'][0]
        check(row[4] == '22:10' and row[5] == '06:05' and row[7] == '00:10' and row[10] == 'P', f'night shift day: {row}')

        # Excel export -> import round trip
        xlsx = call('POST', '/employees/export', {'ids': [e]}, raw=True)
        check(xlsx[:2] == b'PK', 'employee Excel export')
        r = upload('/employees/import', 'emps.xlsx', xlsx)
        check('Updated: 1' in r['message'], 'employee Excel import of the exported file')

        # leave with quota: CL quota 1 day, 2 days leave -> warning, then approve anyway
        types = call('GET', '/leave/types')
        cl = next(t for t in types if t['Code'] == 'CL')
        call('POST', '/leave/types', {**cl, 'YearlyQuota': 1})
        body = {'EmployeeId': e, 'LeaveTypeId': cl['Id'], 'FromDate': '2026-09-08', 'ToDate': '2026-09-09', 'Status': 'Approved', 'ApprovedBy': 'E2E'}
        w = call('POST', '/leave/entries', body)
        check('needsConfirm' in w and 'unpaid' in w['needsConfirm'], 'quota warning before approving')
        check(call('POST', '/leave/entries', {**body, 'confirmQuota': True}).get('ok'), 'approved after confirming')
        reg = call('GET', f'/reports/run?kind=AttendanceRegister&from=2026-09-08&to=2026-09-09&emp={e}')
        check([x[11] for x in reg['rows']] == ['CL', 'LWP'], f"leave days: {[x[11] for x in reg['rows']]}")
        pend = {'EmployeeId': e, 'LeaveTypeId': cl['Id'], 'FromDate': '2026-09-10', 'ToDate': '2026-09-10', 'Status': 'Pending'}
        call('POST', '/leave/entries', pend)
        entries = call('GET', '/leave/entries?year=2026')
        pid = next(x['Id'] for x in entries if x['EmployeeId'] == e and x['Status'] == 'Pending')
        d = call('POST', '/leave/decide', {'ids': [pid], 'decision': 'Rejected', 'by': 'E2E'})
        check(d['changed'] == 1, 'reject a pending leave')

        # holidays
        check(call('POST', '/leave/holidays', {'Date': '2026-09-15', 'Name': 'E2E Day'}).get('ok'), 'add holiday')
        check(call('POST', '/leave/holidays', {'Date': '2026-09-15', 'Name': 'Again'}).get('status') == 400, 'second holiday on the same date refused')

        # rules
        check('saved' in call('PUT', '/settings/attendance-rule', {'windowBeforeHours': 4, 'duplicateMinutes': 2, 'singlePunch': 'Half Day'})['message'], 'attendance rule saved')
        check('saved' in call('PUT', '/settings/salary-rule', {'lateCountForHalfDay': 3, 'otMultiplier': 1.5})['message'], 'salary rule saved')

        # every report, Excel and PDF
        for c in call('GET', '/reports/catalog'):
            q = f"?kind={c['kind']}&from=2026-09-01&to=2026-09-30"
            r = call('GET', '/reports/run' + q)
            check('rows' in r, f"{c['name']}: {len(r.get('rows', []))} rows")
            check(call('GET', '/reports/file' + q + '&format=xlsx', raw=True)[:2] == b'PK', f"{c['name']}: Excel")
            check(call('GET', '/reports/file' + q + '&format=pdf', raw=True)[:4] == b'%PDF', f"{c['name']}: PDF")
        sheet = call('GET', f'/reports/run?kind=SalarySheet&from=2026-09-01&emp={e}')
        check(sheet['rows'][0][3] == '30,000.00' and 'OT × 1.5' in sheet['subtitle'], 'salary sheet uses the salary and the rule')
        check(call('GET', f'/reports/salary-slip?kind=SalarySheet&from=2026-09-01&emp={e}', raw=True)[:4] == b'%PDF', 'salary slip PDF')

        # delete
        call('POST', '/employees/delete', {'ids': [e]})
        check(all(x['Id'] != e for x in call('GET', '/employees/options')), 'employee deleted')
        call('DELETE', f'/shifts/{s}')
        call('DELETE', f'/departments/{b}')
        check(call('DELETE', f'/departments/{a}').get('ok'), 'departments deleted child first, then parent')
        print('ALL PASSED')
    finally:
        subprocess.run(f'taskkill /PID {server.pid} /T /F', shell=True, capture_output=True)


if __name__ == '__main__':
    main()

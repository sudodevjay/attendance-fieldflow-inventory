"""End-to-end test of the employee portal / app API on a COPY of the database (ZkAttendanceTest).

    python web/test/e2e_portal.py

Admin creates logins -> employee logs in, must change the password -> home, check-in, attendance calendar,
leave apply / cancel, regularisation / expense / advance -> manager approves team requests -> admin approves ->
approved regularisation is in the AC Log -> payslip PDF, yearly report, tax.
"""
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = 4003
BASE = f'http://localhost:{PORT}/api'
CS = ('Driver={ODBC Driver 18 for SQL Server};Server=.\\SQLEXPRESS;Database=ZkAttendanceTest;'
      'Trusted_Connection=yes;TrustServerCertificate=yes;')


def call(method, path, body=None, token=None, raw=False):
    h = {'Content-Type': 'application/json'}
    if token:
        h['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(), headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
            return data if raw else json.loads(data)
    except urllib.error.HTTPError as e:
        return {'error': json.loads(e.read()).get('error'), 'status': e.code}


def check(cond, what):
    print(('PASS ' if cond else 'FAIL ') + what)
    if not cond:
        raise SystemExit(1)


def main():
    env = dict(os.environ, PORT=str(PORT), ZK_CONNECTION_STRING=CS)
    server = subprocess.Popen('npx tsx src/server.ts', cwd=os.path.join(ROOT, 'web', 'server'), env=env, shell=True,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(60):
            try:
                call('GET', '/auth/status')
                break
            except Exception:
                time.sleep(0.5)

        # Two employees in one department: 961 (employee), 962 (manager).
        dept = call('POST', '/departments', {'name': 'Portal E2E'})['id']
        shift = call('GET', '/shifts')[0]['Id']
        e1 = call('POST', '/employees', {'EnrollNo': '961', 'Name': 'Portal Worker', 'DepartmentId': dept, 'ShiftId': shift, 'MonthlySalary': 31000,
                                         'JoinDate': '2026-01-01', 'BirthDate': '1990-' + date.today().strftime('%m-%d'), 'IsActive': True})['id']
        e2 = call('POST', '/employees', {'EnrollNo': '962', 'Name': 'Portal Manager', 'DepartmentId': dept, 'ShiftId': shift, 'IsActive': True})['id']

        acc = call('POST', '/portal-admin/accounts', {'ids': [e1, e2]})['accounts']
        pw = {a['EnrollNo']: a['Password'] for a in acc}
        check(len(pw['961']) == 8, 'admin created logins with random passwords')
        check(call('PUT', f'/portal-admin/accounts/{e2}', {'isManager': True}).get('ok'), '962 is a manager')

        check(call('POST', '/portal/login', {'enrollNo': '961', 'password': 'wrong'}).get('status') == 401, 'wrong password refused')
        t1 = call('POST', '/portal/login', {'enrollNo': '961', 'password': pw['961']})
        check(t1.get('mustChange') is True, 'first login must change the password')
        tok = t1['token']
        check(call('POST', '/portal/password', {'current': pw['961'], 'password': 'abc', 'confirm': 'abc'}, tok).get('status') == 400, 'too short password refused')
        check('changed' in call('POST', '/portal/password', {'current': pw['961'], 'password': 'secret61', 'confirm': 'secret61'}, tok)['message'], 'password changed')
        tok = call('POST', '/portal/login', {'enrollNo': '961', 'password': 'secret61'})['token']
        me = call('GET', '/portal/me', token=tok)
        check(me['name'] == 'Portal Worker' and me['department'] == 'Portal E2E' and not me['mustChange'], 'profile after the new password')
        check(call('GET', '/portal/me').get('status') == 401, 'portal refuses a request without a login')

        home = call('GET', '/portal/home', token=tok)
        check('Portal Worker' in home['birthdays'], "today's birthday is shown")
        check(home['team'] is None, 'no team space for a normal employee')
        r = call('POST', '/portal/checkin', {}, tok)
        check('Checked in' in r['message'], 'check-in: ' + r['message'])
        check(call('POST', '/portal/checkin', {}, tok).get('status') == 400, 'second check-in within a minute refused')
        home = call('GET', '/portal/home', token=tok)
        check(home['today']['checkedIn'] and len(home['today']['punches']) == 1, 'home shows the check-in')
        month = call('GET', '/portal/attendance?month=' + date.today().strftime('%Y-%m'), token=tok)
        check(len(month['days']) >= 28, f"attendance calendar: {month['month']}, attendance {month['stats']['attendancePct']}%")

        # leave
        types = call('GET', '/portal/leave', token=tok)['types']
        cl = next(t for t in types if t['Code'] == 'CL')
        d1 = (date.today() + timedelta(days=10)).isoformat()
        check(call('POST', '/portal/leave', {'LeaveTypeId': cl['Id'], 'FromDate': d1, 'ToDate': d1, 'Reason': ''}, tok).get('status') == 400, 'leave without reason refused')
        r = call('POST', '/portal/leave', {'LeaveTypeId': cl['Id'], 'FromDate': d1, 'ToDate': d1, 'Reason': 'family function'}, tok)
        check('Pending' in r['message'], 'leave applied: ' + r['message'].splitlines()[0])
        check(call('POST', '/portal/leave', {'LeaveTypeId': cl['Id'], 'FromDate': d1, 'ToDate': d1, 'Reason': 'again'}, tok).get('status') == 400, 'overlapping leave refused')
        entries = call('GET', '/portal/leave', token=tok)['entries']
        check(entries[0]['Status'] == 'Pending', 'leave shows as Pending')
        admin_entries = call('GET', f"/leave/entries?year={d1[:4]}")
        check(any(x['EnrollNo'] == '961' and x['Status'] == 'Pending' for x in admin_entries), 'the leave request is visible to HR (Leave / Holidays)')

        # regularisation, expense, advance
        y = (date.today() - timedelta(days=1)).isoformat()
        r = call('POST', '/portal/requests', {'Type': 'Regularisation', 'Date': y, 'Time': '09:05', 'Details': 'forgot to punch'}, tok)
        check('regularisation sent' in r['message'], 'regularisation sent')
        check(call('POST', '/portal/requests', {'Type': 'Expense', 'Date': y, 'Category': 'Travel', 'Amount': 450.5, 'Details': 'auto to client',
                                                'Attachment': '/9j/4AAQSkZJRg=='}, tok).get('message'), 'expense claim with receipt sent')
        check(call('POST', '/portal/requests', {'Type': 'Advance', 'Amount': 5000, 'Installments': 5, 'Details': 'medical'}, tok).get('message'), 'advance request sent')
        check(call('POST', '/portal/requests', {'Type': 'Expense', 'Date': y, 'Amount': 0, 'Details': 'x'}, tok).get('status') == 400, 'expense without amount refused')

        # manager approves the leave and the regularisation of his team
        tm = call('POST', '/portal/login', {'enrollNo': '962', 'password': pw['962']})['token']
        team = call('GET', '/portal/team', token=tm)
        check(team['total'] == 1 and team['members'][0]['EnrollNo'] == '961', 'manager sees his team (1 member)')
        mhome = call('GET', '/portal/home', token=tm)
        check(mhome['team'] and len(mhome['team']['leaveRequests']) == 1 and len(mhome['team']['otherRequests']) == 3, 'manager home: team requests')
        lid = team['leaves'][0]['Id']
        check('Approved' in call('POST', '/portal/team/decide', {'kind': 'leave', 'id': lid, 'decision': 'Approved'}, tm)['message'], 'manager approved the leave')
        reg = next(x for x in team['requests'] if x['Type'] == 'Regularisation')
        call('POST', '/portal/team/decide', {'kind': 'request', 'id': reg['Id'], 'decision': 'Approved'}, tm)
        logs = call('GET', f'/logs?from={y}&to={y}')['rows']
        check(any(x['EnrollNo'] == '961' and x['Time'] == '09:05:00' and x['Source'] == 'Manual' for x in logs), 'approved regularisation is in the AC Log')
        check(call('POST', '/portal/team/decide', {'kind': 'leave', 'id': lid, 'decision': 'Rejected'}, tm).get('status') == 400, 'a decided leave cannot be decided again')
        check(call('POST', '/portal/team/decide', {'kind': 'leave', 'id': lid, 'decision': 'Approved'}, tok).get('status') == 403, 'a normal employee cannot approve')

        # HR approves the expense, rejects the advance
        pending = call('GET', '/portal-admin/requests?status=Pending')
        exp = next(x for x in pending if x['Type'] == 'Expense' and x['EnrollNo'] == '961')
        adv = next(x for x in pending if x['Type'] == 'Advance' and x['EnrollNo'] == '961')
        check(exp['HasAttachment'], 'HR sees the receipt')
        check('approved' in call('POST', '/portal-admin/requests/decide', {'ids': [exp['Id']], 'decision': 'Approved', 'by': 'HR'})['message'], 'HR approved the expense')
        call('POST', '/portal-admin/requests/decide', {'ids': [adv['Id']], 'decision': 'Rejected', 'by': 'HR', 'note': 'not now'})
        mine = call('GET', '/portal/requests', token=tok)
        st = {x['Type']: x['Status'] for x in mine}
        check(st == {'Regularisation': 'Approved', 'Expense': 'Approved', 'Advance': 'Rejected'}, f'employee sees the decisions {st}')
        check(call('DELETE', f"/portal/requests/{adv['Id']}", token=tok).get('status') == 400, 'a decided request cannot be cancelled')

        # payroll
        pdf = call('GET', '/portal/payslip?month=' + date.today().strftime('%Y-%m'), token=tok, raw=True)
        check(pdf[:4] == b'%PDF', 'own payslip PDF')
        yr = call('GET', f'/portal/payroll/yearly?year={date.today().year}', token=tok)
        check(len(yr['rows']) >= 1 and yr['rows'][0]['salary'] == 31000, f"yearly report: {len(yr['rows'])} month(s)")
        tax = call('GET', '/portal/payroll/tax', token=tok)
        check(tax['reimbursed'] == 450.5, f"tax page: FY {tax['fy']}, reimbursed {tax['reimbursed']}")
        check(isinstance(call('GET', f'/portal/holidays?year={date.today().year}', token=tok), list), 'holidays list')

        # settings: check-in off
        call('PUT', '/portal-admin/settings', {'allowCheckIn': False, 'officeName': 'E2E Office'})
        check(call('POST', '/portal/checkin', {'checkOut': True}, tok).get('status') == 400, 'check-in refused when turned off')
        check(call('GET', '/portal/me', token=tok)['office'] == 'E2E Office', 'office name from the settings')
        call('PUT', '/portal-admin/settings', {'allowCheckIn': True, 'officeName': ''})

        # removing the login ends the session
        call('POST', '/portal-admin/accounts/delete', {'ids': [e1]})
        check(call('GET', '/portal/me', token=tok).get('status') == 401, 'removed login is logged out')
        print('ALL PASSED')
    finally:
        subprocess.run(f'taskkill /PID {server.pid} /T /F', shell=True, capture_output=True)


if __name__ == '__main__':
    main()

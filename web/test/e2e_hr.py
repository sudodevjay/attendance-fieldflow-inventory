"""End-to-end test of the HR features on a COPY of the database (ZkAttendanceTest).

    python web/test/e2e_hr.py

HR profile (reporting manager, statutory ids, bank), shift break, roster (rotating shifts / day off), comp-off, overtime
approval, salary structure with PF and a fixed deduction, payroll reports, notifications, profile change request,
documents, users with roles, audit log, dashboard.
"""
import base64
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from datetime import date, timedelta

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = 4004
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


def upload(path, filename, content, title, token=None):
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n{title}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f'Content-Type: application/octet-stream\r\n\r\n').encode() + content + f'\r\n--{boundary}--\r\n'.encode()
    h = {'Content-Type': f'multipart/form-data; boundary={boundary}'}
    if token:
        h['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(BASE + path, method='POST', data=body, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {'error': json.loads(e.read()).get('error'), 'status': e.code}


def check(cond, what):
    print(('PASS ' if cond else 'FAIL ') + what)
    if not cond:
        raise SystemExit(1)


def row_of(report, enroll, date_text=None):
    cols = report['columns']
    for r in report['rows']:
        if enroll in r and (date_text is None or r[0].startswith(date_text)):
            return dict(zip(cols, r))
    return None


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

        t = date.today()
        # Monday-to-Friday days of last week in this month when possible: break day, day off (roster), overtime day.
        d_break, d_off, d_ot = t - timedelta(days=7), t - timedelta(days=6), t - timedelta(days=5)
        month = d_break.strftime('%Y-%m')

        # ---- shift with a break, employees, HR profile
        sh = call('POST', '/shifts', {'Name': 'HR Break Shift', 'Start': '09:00', 'End': '18:00', 'LateGraceMinutes': 10, 'EarlyGraceMinutes': 10,
                                      'HalfDayMinutes': 240, 'MinOvertimeMinutes': 30, 'WeeklyOffs': ['Sunday'], 'BreakMinutes': 60,
                                      'BreakStart': '13:00', 'BreakEnd': '14:00', 'DeductBreak': True})['id']
        check(call('POST', '/shifts', {'Name': 'x', 'Start': '09:00', 'End': '18:00', 'LateGraceMinutes': 0, 'EarlyGraceMinutes': 0, 'HalfDayMinutes': 0,
                                       'MinOvertimeMinutes': 0, 'BreakMinutes': 30, 'BreakStart': '13:00'}).get('status') == 400, 'break start without end refused')
        shifts = call('GET', '/shifts')
        s = next(x for x in shifts if x['Id'] == sh)
        check(s['BreakMinutes'] == 60 and s['WorkHours'] == '08:00' and s['BreakStart'] == '13:00', 'shift with 60 min break: 8 working hours')
        sh2 = call('POST', '/shifts', {'Name': 'HR Night', 'Start': '22:00', 'End': '06:00', 'LateGraceMinutes': 10, 'EarlyGraceMinutes': 10,
                                       'HalfDayMinutes': 240, 'MinOvertimeMinutes': 30, 'WeeklyOffs': []})['id']
        dept = call('POST', '/departments', {'name': 'HR E2E'})['id']
        emp = lambda no, name, sal: call('POST', '/employees', {'EnrollNo': no, 'Name': name, 'DepartmentId': dept, 'ShiftId': sh, 'MonthlySalary': sal,
                                                                  'JoinDate': '2026-01-01', 'IsActive': True})['id']
        e1, e2, e3 = emp('971', 'HR Worker', 30000), emp('972', 'HR Lead', 50000), emp('973', 'HR Other', 20000)
        det = call('GET', f'/employees/{e1}')
        body = {**{k: det[k] for k in ('EnrollNo', 'Name', 'DepartmentId', 'ShiftId', 'MonthlySalary', 'IsActive')}, 'JoinDate': '2026-01-01'}
        check(call('PUT', f'/employees/{e1}', {**body, 'Profile': {'Pan': 'BAD'}}).get('status') == 400, 'invalid PAN refused')
        prof = {'ReportingManagerId': e2, 'Pan': 'abcde1234f', 'Uan': '100200300400', 'EmergencyName': 'Asha', 'EmergencyRelation': 'Mother',
                'EmergencyPhone': '9800000000', 'BankName': 'SBI', 'BankAccount': '1234567890', 'BankIfsc': 'SBIN0001234', 'PfApplicable': True, 'TdsMonthly': 300}
        check(call('PUT', f'/employees/{e1}', {**body, 'Profile': prof}).get('id') == e1, 'HR profile saved')
        det = call('GET', f'/employees/{e1}')
        check(det['Profile']['Pan'] == 'ABCDE1234F' and det['Profile']['ReportingManager'] == 'HR Lead', 'profile read back (PAN upper case, manager name)')
        d2 = call('GET', f'/employees/{e2}')
        b2 = {**{k: d2[k] for k in ('EnrollNo', 'Name', 'DepartmentId', 'ShiftId', 'MonthlySalary', 'IsActive')}}
        check(call('PUT', f'/employees/{e2}', {**b2, 'Profile': {'ReportingManagerId': e1}}).get('status') == 400, 'circular reporting refused')
        check(any(x['Name'] == 'Basic' for x in det['Salary']), 'salary structure in the employee detail')

        # ---- break: 09:00 13:00 14:30 18:30 = 9.5 h span, 90 min break, 8 h worked, remark
        for hm_ in ('09:00', '13:00', '14:30', '18:30'):
            call('POST', '/logs/manual', {'employeeId': e1, 'time': f'{d_break.isoformat()} {hm_}:00', 'checkOut': False, 'remark': 'e2e'})
        r = call('GET', f'/reports/run?kind=DailyAttendance&from={d_break.isoformat()}&emp={e1}')
        row = row_of(r, '971')
        check(row and row['Worked'] == '08:00' and 'Break 90 min' in row['Remark'], f"break taken off worked time: {row and row['Worked']}, {row and row['Remark']}")

        # ---- roster: day off on d_off, rotation
        check('saved' in call('POST', '/roster', {'cells': [{'employeeId': e1, 'date': d_off.isoformat(), 'value': 'OFF'}]})['message'], 'roster day off saved')
        for hm_ in ('10:00', '15:00'):
            call('POST', '/logs/manual', {'employeeId': e1, 'time': f'{d_off.isoformat()} {hm_}:00', 'checkOut': False, 'remark': 'e2e'})
        r = call('GET', f'/reports/run?kind=DailyAttendance&from={d_off.isoformat()}&emp={e1}')
        row = row_of(r, '971')
        check(row and 'Worked on weekly off' in row['Remark'] and row['OT'] == '04:00', f"worked on the roster day off counts as OT (break off): {row and row['OT']}")
        rot_from, rot_to = t + timedelta(days=1), t + timedelta(days=6)
        msg = call('POST', '/roster/rotate', {'employeeIds': [e3], 'pattern': [str(sh), str(sh2)], 'from': rot_from.isoformat(), 'to': rot_to.isoformat(),
                                              'everyDays': 2, 'offDays': ['Sunday']})
        check('Rotation saved' in msg.get('message', ''), 'rotation generated')
        g = call('GET', f'/roster?from={rot_from.isoformat()}&to={rot_to.isoformat()}&dept={dept}')
        cells = next(x for x in g['rows'] if x['EnrollNo'] == '973')['cells']
        vals = [c['value'] for c, d in zip(cells, g['days']) if date.fromisoformat(d['date']).weekday() != 6]
        check(vals[:2] == [str(sh)] * 2 and vals[2:4] == [str(sh2)] * 2, f'rotation changes the shift every 2 days {vals}')
        check(call('POST', '/roster/clear', {'ids': [e3], 'from': rot_from.isoformat(), 'to': rot_to.isoformat()}).get('message'), 'roster cleared')

        # ---- portal logins: worker, manager (only through reporting manager, not ticked)
        acc = {a['EnrollNo']: a['Password'] for a in call('POST', '/portal-admin/accounts', {'ids': [e1, e2, e3]})['accounts']}
        tok = call('POST', '/portal/login', {'enrollNo': '971', 'password': acc['971']})['token']
        tm = call('POST', '/portal/login', {'enrollNo': '972', 'password': acc['972']})['token']
        team = call('GET', '/portal/team', token=tm)
        check(team.get('total') == 1 and team['members'][0]['EnrollNo'] == '971', 'reporting manager sees the direct report (not ticked as manager)')
        me = call('GET', '/portal/me', token=tok)
        check(me['reportingManager'] == 'HR Lead' and me['hr']['BankAccount'].endswith('7890') and '1234567890' not in me['hr']['BankAccount'],
              'employee sees own HR profile, bank account masked')

        # ---- comp-off for the worked day off
        check(call('POST', '/portal/requests', {'Type': 'CompOff', 'Date': d_break.isoformat(), 'Details': 'x'}, tok).get('status') == 400,
              'comp-off refused for a normal working day')
        check('Comp-off request sent' in call('POST', '/portal/requests', {'Type': 'CompOff', 'Date': d_off.isoformat(), 'Details': 'worked on off day'}, tok)['message'],
              'comp-off requested for the worked day off')
        notes = call('GET', '/portal/notifications', token=tm)
        check(notes['unread'] >= 1 and 'Comp-off request' in notes['items'][0]['Title'], 'manager notified of the request')
        req = next(x for x in call('GET', '/portal/team', token=tm)['requests'] if x['Type'] == 'CompOff')
        call('POST', '/portal/team/decide', {'kind': 'request', 'id': req['Id'], 'decision': 'Approved'}, tm)
        bal = call('GET', '/portal/comp-off', token=tok)
        check(bal['available'] == 1, f"comp-off balance 1 after approval ({bal})")
        mine = call('GET', '/portal/notifications', token=tok)
        check(any('approved' in n['Title'] for n in mine['items']), 'employee notified of the decision')
        co = next(x for x in call('GET', '/portal/leave', token=tok)['types'] if x['Code'] == 'CO')
        fut = t + timedelta(days=14)
        while fut.weekday() == 6:
            fut += timedelta(days=1)
        check('Pending' in call('POST', '/portal/leave', {'LeaveTypeId': co['Id'], 'FromDate': fut.isoformat(), 'ToDate': fut.isoformat(), 'Reason': 'comp off'}, tok)['message'],
              'comp-off leave applied')
        fut2 = fut + timedelta(days=1)
        check(call('POST', '/portal/leave', {'LeaveTypeId': co['Id'], 'FromDate': fut2.isoformat(), 'ToDate': fut2.isoformat(), 'Reason': 'again'}, tok).get('status') == 400,
              'second comp-off leave refused: no balance')

        # ---- overtime approval: 09:00-21:00 = 3 h OT, 1 h approved
        for hm_ in ('09:00', '21:00'):
            call('POST', '/logs/manual', {'employeeId': e1, 'time': f'{d_ot.isoformat()} {hm_}:00', 'checkOut': False, 'remark': 'e2e'})
        check('Overtime request sent' in call('POST', '/portal/requests', {'Type': 'Overtime', 'Date': d_ot.isoformat(), 'Hours': 1, 'Details': 'month end'}, tok)['message'],
              'overtime requested')
        req = next(x for x in call('GET', '/portal/team', token=tm)['requests'] if x['Type'] == 'Overtime' and x['Status'] == 'Pending')
        call('POST', '/portal/team/decide', {'kind': 'request', 'id': req['Id'], 'decision': 'Approved'}, tm)
        rule = call('GET', '/settings/salary-rule')
        call('PUT', '/settings/salary-rule', {**rule, 'otRequiresApproval': True})
        sheet = call('GET', f'/reports/run?kind=SalarySheet&from={month}-01&emp={e1}')
        r1 = dict(zip(sheet['columns'], sheet['rows'][0]))
        check(r1['OT Hrs'] == '01:00' and 'not approved' in r1['Remark'], f"only approved OT is paid: {r1['OT Hrs']}")
        call('PUT', '/settings/salary-rule', {**rule, 'otRequiresApproval': False})

        # ---- statutory: PF on, fixed deduction component
        base_net = float(r1['Net Pay'].replace(',', '')) + float(r1['PF / ESI / PT / TDS / Other'].replace(',', ''))
        call('PUT', '/payroll/statutory', {'pfEnabled': True, 'pfPct': 12, 'pfWageCap': 15000})
        comp = call('POST', '/payroll/components', {'Name': 'Canteen', 'Kind': 'Deduction', 'Calc': 'Fixed', 'Value': 500, 'SortOrder': 20})
        check(comp.get('ok'), 'fixed deduction component added')
        call('PUT', '/settings/salary-rule', {**rule, 'otRequiresApproval': True})
        sheet = call('GET', f'/reports/run?kind=SalarySheet&from={month}-01&emp={e1}')
        r2 = dict(zip(sheet['columns'], sheet['rows'][0]))
        other = float(r2['PF / ESI / PT / TDS / Other'].replace(',', ''))
        net2 = float(r2['Net Pay'].replace(',', ''))
        check(other > 800 and abs(net2 - (base_net - other)) < 0.02,
              f"PF + TDS 300 + canteen 500 deducted: {r2['PF / ESI / PT / TDS / Other']} (net {base_net} -> {net2})")
        reg = call('GET', f'/reports/run?kind=PayrollRegister&from={month}-01&emp={e1}')
        rr = dict(zip(reg['columns'], reg['rows'][0]))
        check('Basic' in reg['columns'] and rr['Basic'] == '15,000.00' and 'Canteen' in reg['columns'], 'payroll register with Basic 50% and Canteen')
        stat = call('GET', f'/reports/run?kind=Statutory&from={month}-01&emp={e1}')
        sr = dict(zip(stat['columns'], stat['rows'][0]))
        check(sr['UAN'] == '100200300400' and float(sr['PF (Employee)'].replace(',', '')) > 0, f"statutory report: PF {sr['PF (Employee)']}")
        bank = call('GET', f'/reports/run?kind=BankTransfer&from={month}-01&dept={dept}')
        br = row_of(bank, '971')
        check(br and br['Account No'] == '1234567890' and br['IFSC'] == 'SBIN0001234', 'bank transfer statement has the account')
        check(any('missing' in str(x[-1]) for x in bank['rows'] if '972' in x), 'bank transfer flags missing bank details')
        # a 1x1 PNG as company logo; the slip must still render
        png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        check('saved' in call('PUT', '/settings/logo', {'logo': png})['message'], 'company logo saved')
        check(call('GET', f'/reports/salary-slip?from={month}-01&emp={e1}', raw=True)[:4] == b'%PDF', 'salary slip PDF with structure, PF and logo')
        check(call('GET', f'/portal/payslip?month={month}', token=tok, raw=True)[:4] == b'%PDF', 'employee payslip PDF')
        for kind in ('DepartmentSummary', 'Requests', 'CompOff'):
            rep = call('GET', f'/reports/run?kind={kind}&from={month}-01&to={t.isoformat()}&dept={dept}')
            check('rows' in rep, f"{kind} report: {len(rep.get('rows', []))} row(s)")
            check(call('GET', f'/reports/file?kind={kind}&from={month}-01&to={t.isoformat()}&dept={dept}&format=pdf', raw=True)[:4] == b'%PDF', f'{kind} PDF')
        # undo the company-wide changes for the other tests
        call('PUT', '/settings/salary-rule', {**rule, 'otRequiresApproval': False})
        call('PUT', '/payroll/statutory', {'pfEnabled': False})
        cid = next(x for x in call('GET', '/payroll/components') if x['Name'] == 'Canteen')['Id']
        call('DELETE', f'/payroll/components/{cid}')
        call('PUT', '/settings/logo', {'logo': ''})

        # ---- profile change request -> HR approves -> applied
        check(call('POST', '/portal/requests', {'Type': 'Profile', 'Changes': {'BankIfsc': 'bad'}}, tok).get('status') == 400, 'invalid IFSC in a change request refused')
        call('POST', '/portal/requests', {'Type': 'Profile', 'Changes': {'Phone': '9811111111', 'EmergencyPhone': '9822222222', 'PfNo': 'hack'}}, tok)
        preq = next(x for x in call('GET', '/portal-admin/requests?status=Pending&type=Profile') if x['EnrollNo'] == '971')
        check(preq['Changes'] == {'Phone': '9811111111', 'EmergencyPhone': '9822222222'}, 'profile request keeps only allowed fields')
        check(call('POST', '/portal/team/decide', {'kind': 'request', 'id': preq['Id'], 'decision': 'Approved'}, tm).get('status') == 403,
              'manager cannot approve a profile change')
        call('POST', '/portal-admin/requests/decide', {'ids': [preq['Id']], 'decision': 'Approved', 'by': 'HR'})
        det = call('GET', f'/employees/{e1}')
        check(det['Phone'] == '9811111111' and det['Profile']['EmergencyPhone'] == '9822222222', 'approved profile change applied')

        # ---- documents
        d = upload(f'/employees/{e1}/documents', 'offer.pdf', b'%PDF-1.4 test', 'Offer letter')
        check(d.get('id'), 'HR uploaded a document')
        check(upload(f'/employees/{e1}/documents', 'evil.html', b'<script>', 'x').get('status') == 400, 'HTML document refused')
        docs = call('GET', '/portal/documents', token=tok)
        check(docs[0]['Title'] == 'Offer letter', 'employee sees the document')
        check(call('GET', f"/portal/documents/{docs[0]['Id']}", token=tok, raw=True)[:4] == b'%PDF', 'employee downloads it')
        check(call('GET', f"/portal/documents/{docs[0]['Id']}", token=tm).get('status') == 404, "another employee cannot download it")
        check(call('DELETE', f"/portal/documents/{docs[0]['Id']}", token=tok).get('status') == 400, 'employee cannot delete an HR document')
        own = upload('/portal/documents', 'id.jpg', b'\xff\xd8\xff', 'ID proof', tok)
        check(call('DELETE', f"/portal/documents/{own['id']}", token=tok).get('message'), 'employee deletes own upload')

        # ---- notifications for HR, announcements
        hr = call('GET', '/notifications')
        check(hr['unread'] >= 1, f"HR notifications: {hr['unread']} unread")
        call('POST', '/notifications/read', {'all': True})
        check(call('GET', '/notifications')['unread'] == 0, 'HR marked all read')
        check('3 employee' in call('POST', '/notifications/broadcast', {'title': 'Office closed Friday', 'body': 'Diwali', 'departmentId': dept})['message'],
              'announcement to the department')
        check(any(n['Title'] == 'Office closed Friday' for n in call('GET', '/portal/notifications', token=tok)['items']), 'employee got the announcement')

        # ---- users with roles
        uname = 'hr' + uuid.uuid4().hex[:6]
        check(call('POST', '/users', {'UserName': uname, 'FullName': 'HR User', 'Role': 'HR', 'Password': 'short'}).get('status') == 400, 'short password refused')
        uid = call('POST', '/users', {'UserName': uname, 'FullName': 'HR User', 'Role': 'HR', 'Password': 'hrpass1'})['id']
        ht = call('POST', '/auth/login', {'user': uname, 'password': 'hrpass1'})
        check(ht.get('role') == 'HR', 'HR user logged in with role HR')
        ht = ht['token']
        check(call('GET', '/auth/me', token=ht)['permissions']['write'].count('settings') == 0, 'HR permissions: no settings')
        check(call('GET', '/users', token=ht).get('status') == 403, 'HR cannot open users')
        check(call('PUT', '/settings/company', {'companyName': 'x', 'autoSyncMinutes': 5}, ht).get('status') == 403, 'HR cannot change company settings')
        check('cards' in call('GET', '/dashboard', token=ht), 'HR opens the dashboard')
        check(call('PUT', f'/users/{uid}', {'UserName': uname, 'Role': 'Viewer'}).get('id') == uid, 'role changed to Viewer')
        # (without a Supervisor password the server PC itself is always Supervisor, so the old token just falls back to that)
        check(call('GET', '/auth/me', token=ht)['user'] != uname, 'changing the role ends the session')
        vt = call('POST', '/auth/login', {'user': uname, 'password': 'hrpass1'})['token']
        check(call('POST', '/departments', {'name': 'nope'}, vt).get('status') == 403, 'Viewer cannot add a department')
        check('rows' in call('GET', f'/reports/run?kind=DailyAttendance&from={t.isoformat()}', token=vt), 'Viewer runs reports')
        call('DELETE', f'/users/{uid}')

        # ---- audit log, dashboard
        log = call('GET', f'/audit?from={t.isoformat()}&to={t.isoformat()}')
        check(any(x['UserName'] == uname and 'Login' in x['Action'] for x in log), 'login in the audit log')
        check(any('employees' in x['Path'] and 'PUT' in x['Path'] for x in log), 'employee change in the audit log')
        check(not any('hrpass1' in (x['Details'] or '') for x in log), 'no passwords in the audit log')
        check(call('GET', f'/audit/export?from={t.isoformat()}&to={t.isoformat()}', raw=True)[:2] == b'PK', 'audit log Excel')
        dash = call('GET', '/dashboard')
        check(dash['cards']['total'] > 0 and any(x['name'] == 'HR E2E' for x in dash['departments']) and len(dash['month']['trend']) >= 1,
              f"dashboard: {dash['cards']}")

        # ---- clean up (employees with their HR rows)
        call('POST', '/employees/delete', {'ids': [e1, e2, e3]})
        check(call('GET', f'/employees/{e1}').get('status') == 404, 'employees deleted with their HR data')
        print('ALL PASSED')
    finally:
        subprocess.run(f'taskkill /PID {server.pid} /T /F', shell=True, capture_output=True)


if __name__ == '__main__':
    main()

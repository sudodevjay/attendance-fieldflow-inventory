"""End-to-end test of the roles, on the test PostgreSQL database (make_test_db.ps1).

    python web/test/e2e_roles.py

Administrator program: SuperAdmin (Supervisor), Admin, HR and an HOD who only sees their department (with its
sub-departments) and no salaries. Portal: employee -> team lead -> manager with the two-step approval (the team lead
approves first, the manager decides; a rejection is final); the manager sees the team lead's team too.
"""
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = 4004
BASE = f'http://localhost:{PORT}/api'
CS = os.environ.get('ZK_TEST_DATABASE_URL', 'postgresql://postgres:zkpass@localhost:5433/zkattendance_test')


def call(method, path, body=None, token=None):
    h = {'Content-Type': 'application/json'}
    if token:
        h['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(), headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
            return json.loads(data) if data[:1] in (b'{', b'[') else {'raw': len(data)}
    except urllib.error.HTTPError as e:
        return {'error': json.loads(e.read()).get('error'), 'status': e.code}


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
        me = call('GET', '/auth/me')
        check(me['role'] == 'SuperAdmin' and 'system' in me['permissions']['write'], 'Supervisor = SuperAdmin with users and system')

        # Departments: Sales R (child Sales R North) and Ops R
        sales = call('POST', '/departments', {'name': 'Sales R'})['id']
        north = call('POST', '/departments', {'name': 'Sales R North', 'parentId': sales})['id']
        ops = call('POST', '/departments', {'name': 'Ops R'})['id']
        shift = call('GET', '/shifts')[0]['Id']

        def emp(no, name, dept):
            return call('POST', '/employees', {'EnrollNo': no, 'Name': name, 'DepartmentId': dept, 'ShiftId': shift, 'MonthlySalary': 30000, 'IsActive': True})['id']
        mgr, tl, worker, other = emp('981', 'R Manager', sales), emp('982', 'R Lead', north), emp('983', 'R Worker', north), emp('984', 'R Ops', ops)

        def report_to(e, m):
            d = call('GET', f'/employees/{e}')
            b = {k: d[k] for k in ('EnrollNo', 'Name', 'DepartmentId', 'ShiftId', 'MonthlySalary', 'IsActive')}
            r = call('PUT', f'/employees/{e}', {**b, 'Profile': {'ReportingManagerId': m}})
            check('error' not in r, f'reporting manager set ({r})')
        report_to(worker, tl)
        report_to(tl, mgr)

        # Portal logins and roles
        pw = {a['EnrollNo']: a['Password'] for a in call('POST', '/portal-admin/accounts', {'ids': [mgr, tl, worker]})['accounts']}
        check(call('PUT', f'/portal-admin/accounts/{mgr}', {'role': 'Manager'}).get('ok'), '981 is a Manager')
        check(call('PUT', f'/portal-admin/accounts/{tl}', {'role': 'TeamLead'}).get('ok'), '982 is a Team Lead')
        check(call('PUT', f'/portal-admin/accounts/{tl}', {'role': 'Boss'}).get('status') == 400, 'unknown portal role refused')
        acc = {a['EnrollNo']: a for a in call('GET', '/portal-admin/accounts')}
        check(acc['982']['Role'] == 'TeamLead' and acc['981']['Role'] == 'Manager' and acc['983']['Role'] == 'Employee', 'roles listed')

        # Administrator users: HOD of Sales R, Admin, HR
        check(call('POST', '/users', {'UserName': 'hod.sales', 'Role': 'HOD', 'Password': 'hod12345'}).get('status') == 400, 'HOD without a department refused')
        check('id' in call('POST', '/users', {'UserName': 'hod.sales', 'FullName': 'Sales Head', 'Role': 'HOD', 'DepartmentId': sales, 'Password': 'hod12345'}), 'HOD user created')
        call('POST', '/users', {'UserName': 'admin.r', 'Role': 'Admin', 'Password': 'admin123'})
        call('POST', '/users', {'UserName': 'hr.r', 'Role': 'HR', 'Password': 'hr123456'})
        users = {u['UserName']: u for u in call('GET', '/users')['users']}
        check(users['hod.sales']['Department'] == 'Sales R', 'the HOD shows their department')
        hod = call('POST', '/auth/login', {'user': 'hod.sales', 'password': 'hod12345'})['token']
        adm = call('POST', '/auth/login', {'user': 'admin.r', 'password': 'admin123'})['token']
        hr = call('POST', '/auth/login', {'user': 'hr.r', 'password': 'hr123456'})['token']

        # HOD: only Sales R + North, no salaries, no settings
        hme = call('GET', '/auth/me', token=hod)
        check(hme['role'] == 'HOD' and hme['permissions']['scoped'] and 'payroll' not in hme['permissions']['read'], 'HOD permissions (scoped, no payroll)')
        nos = {e['EnrollNo'] for e in call('GET', '/employees', token=hod)}
        check(nos == {'981', '982', '983'}, f'HOD sees only their department and sub-department ({sorted(nos)})')
        check(call('GET', f'/employees/{other}', token=hod).get('status') == 403, 'HOD cannot open an employee of another department')
        depts = {d['Name'] for d in call('GET', '/departments', token=hod)['departments']}
        check(depts == {'Sales R', 'Sales R North'}, f'HOD department tree ({sorted(depts)})')
        kinds = {c['kind'] for c in call('GET', '/reports/catalog', token=hod)}
        check('SalarySheet' not in kinds and 'DailyAttendance' in kinds, 'no salary reports in the HOD catalog')
        t = date.today().isoformat()
        check(call('GET', f'/reports/run?kind=SalarySheet&from={t}', token=hod).get('status') == 403, 'HOD cannot run the salary sheet')
        rep = call('GET', f'/reports/run?kind=DailyAttendance&from={t}', token=hod)
        ids = {r[0] for r in rep['rows']} if rep.get('rows') and isinstance(rep['rows'][0], list) else {str(r.get('Emp ID', r.get('EnrollNo'))) for r in rep.get('rows', [])}
        check('984' not in json.dumps(rep) and '983' in json.dumps(rep), 'HOD daily report only has their department')
        check(call('GET', '/settings/pi', token=hod).get('status') == 403, 'HOD cannot open the Raspberry Pi settings')
        check(call('POST', '/leave/holidays', {'Date': t, 'Name': 'x'}, hod).get('status') == 403, 'HOD cannot change holidays')
        check(call('POST', '/employees', {'EnrollNo': '989', 'Name': 'x'}, hod).get('status') == 403, 'HOD cannot add employees')

        # Admin: everything but users / system; HR as before
        check(call('GET', '/users', token=adm).get('status') == 403, 'Admin cannot manage users (SuperAdmin only)')
        check(call('GET', '/settings/backup', token=adm).get('status') == 403, 'Admin cannot download the backup')
        check(len(call('GET', '/employees', token=adm)) >= 4, 'Admin sees all employees')
        check(call('GET', f'/reports/run?kind=SalarySheet&from={t}', token=adm).get('rows') is not None, 'Admin runs the salary sheet')
        check(call('POST', '/leave/holidays', {'Date': (date.today() + timedelta(days=200)).isoformat(), 'Name': 'R holiday'}, hr).get('status') is None, 'HR adds a holiday')
        check(call('GET', '/users', token=hr).get('status') == 403, 'HR cannot manage users')

        # Portal: worker -> team lead -> manager
        tw = call('POST', '/portal/login', {'enrollNo': '983', 'password': pw['983']})['token']
        ttl = call('POST', '/portal/login', {'enrollNo': '982', 'password': pw['982']})['token']
        tm = call('POST', '/portal/login', {'enrollNo': '981', 'password': pw['981']})['token']
        check(call('GET', '/portal/me', token=ttl)['role'] == 'TeamLead' and call('GET', '/portal/me', token=ttl)['isManager'], 'team lead has a team space')
        check({m['EnrollNo'] for m in call('GET', '/portal/team', token=ttl)['members']} == {'983'}, 'team lead sees their team')
        check({m['EnrollNo'] for m in call('GET', '/portal/team', token=tm)['members']} == {'982', '983'}, "manager sees the team lead and the team lead's team")
        check(call('GET', '/portal/team', token=tw).get('status') == 403, 'an employee has no team')

        cl = next(x for x in call('GET', '/portal/leave', token=tw)['types'] if x['Code'] == 'CL')
        d1 = (date.today() + timedelta(days=20)).isoformat()
        d2 = (date.today() + timedelta(days=25)).isoformat()
        call('POST', '/portal/leave', {'LeaveTypeId': cl['Id'], 'FromDate': d1, 'ToDate': d1, 'Reason': 'wedding'}, tw)
        call('POST', '/portal/leave', {'LeaveTypeId': cl['Id'], 'FromDate': d2, 'ToDate': d2, 'Reason': 'trip'}, tw)
        leaves = {l['FromIso']: l for l in call('GET', '/portal/team', token=tm)['leaves']}
        check(leaves[d1]['Stage'] == 'Waiting for team lead' and leaves[d1]['CanDecide'], "manager sees 'waiting for team lead' (and may decide)")
        tl_leaves = {l['FromIso']: l for l in call('GET', '/portal/team', token=ttl)['leaves']}
        check(tl_leaves[d1]['Step'] == 'first' and tl_leaves[d1]['CanDecide'], 'team lead: step 1')
        notes = call('GET', '/portal/notifications', token=ttl)
        check(any('leave' in n['Title'].lower() for n in notes.get('items', notes if isinstance(notes, list) else [])), 'the team lead was notified of the new leave')

        r = call('POST', '/portal/team/decide', {'kind': 'leave', 'id': tl_leaves[d1]['Id'], 'decision': 'Approved'}, ttl)
        check('goes to the manager' in r['message'], 'team lead approved: ' + r['message'])
        check(call('POST', '/portal/team/decide', {'kind': 'leave', 'id': tl_leaves[d1]['Id'], 'decision': 'Approved'}, ttl).get('status') == 403, 'team lead cannot approve twice')
        mine = {l['FromIso']: l for l in call('GET', '/portal/leave', token=tw)['entries']}
        check(mine[d1]['Status'] == 'Pending' and mine[d1]['FirstApprovedBy'] == 'R Lead', 'still pending for the employee, approved by the team lead')
        leaves = {l['FromIso']: l for l in call('GET', '/portal/team', token=tm)['leaves']}
        check(leaves[d1]['Stage'].startswith('Approved by team lead R Lead') and leaves[d1]['Step'] == 'final', 'manager: waiting for the final decision')
        r = call('POST', '/portal/team/decide', {'kind': 'leave', 'id': leaves[d1]['Id'], 'decision': 'Approved'}, tm)
        check(r['message'] == 'Approved.', 'manager approved (final)')
        adm_leave = next(x for x in call('GET', f'/leave/entries?year={d1[:4]}') if x['Id'] == leaves[d1]['Id'])
        check(adm_leave['Status'] == 'Approved' and adm_leave['ApprovedBy'] == 'R Manager' and adm_leave['FirstApprovedBy'] == 'R Lead', 'HR sees both approvals')

        r = call('POST', '/portal/team/decide', {'kind': 'leave', 'id': tl_leaves[d2]['Id'], 'decision': 'Rejected', 'note': 'busy'}, ttl)
        mine = {l['FromIso']: l for l in call('GET', '/portal/leave', token=tw)['entries']}
        check(mine[d2]['Status'] == 'Rejected', "the team lead's rejection is final")

        # A request of the team lead goes straight to the manager
        y = (date.today() - timedelta(days=1)).isoformat()
        call('POST', '/portal/requests', {'Type': 'Regularisation', 'Date': y, 'Time': '09:10', 'Details': 'lead forgot'}, ttl)
        req = next(x for x in call('GET', '/portal/team', token=tm)['requests'] if x['EnrollNo'] == '982')
        check(req['Step'] == 'final' and req['Stage'] == '', "the team lead's own request: the manager decides alone")

        # HOD decides a pending leave of their department, not of another one
        d3 = (date.today() + timedelta(days=30)).isoformat()
        call('POST', '/portal/leave', {'LeaveTypeId': cl['Id'], 'FromDate': d3, 'ToDate': d3, 'Reason': 'exam'}, tw)
        lid = next(x['Id'] for x in call('GET', f'/leave/entries?year={d3[:4]}', token=hod) if x['FromIso'] == d3 and x['EnrollNo'] == '983')
        r = call('POST', '/leave/decide', {'ids': [lid], 'approve': True, 'by': 'Sales Head'}, hod)
        check(r.get('changed') == 1, f'HOD approved a leave of their department ({r})')
        other_leave = call('POST', '/leave/entries', {'EmployeeId': other, 'LeaveTypeId': cl['Id'], 'FromDate': d3, 'ToDate': d3, 'Reason': 'x', 'Status': 'Pending'}, hod)
        check(other_leave.get('status') == 403, 'HOD cannot enter leave for another department')
        print('ALL PASSED')
    finally:
        subprocess.run(f'taskkill /PID {server.pid} /T /F', shell=True, capture_output=True)


if __name__ == '__main__':
    main()

"""End-to-end test of the inventory: the attendance server (login, employees, the gateway) and the inventory service
(inventory-api, its own database), each on an empty PostgreSQL test database.

    docker exec zk-pg psql -U postgres -c "DROP DATABASE IF EXISTS zkinventory_test WITH (FORCE)" -c "CREATE DATABASE zkinventory_test" -c "DROP DATABASE IF EXISTS zkinventory_svc_test WITH (FORCE)" -c "CREATE DATABASE zkinventory_svc_test"
    python web/test/e2e_inventory.py

Masters, opening stock, issue → automatic re-order draft PO, PO → goods receipt (weighted average cost), requisition →
HOD approval → issue, roles (StoreKeeper only inventory, HR no inventory), employee portal request with auto approve /
auto issue, returnable items → overdue reminder / exit clearance, transfer, stock count, adjustment, reports, deleting an
employee in attendance keeps the inventory history, backup includes the inventory tables; material for work sites (issued for
a site, installed there by the store or from the portal, left-overs returned, site stock / register, inactive / deleted site);
serial units with RFID / QR tags (tagging, scanning, issue / return / transfer / count / installed by unit), employee bins
with a limit; locations (rack / row / column) with RECEIVING, put-away, picks / receipts / returns / counts per location.
"""
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = 4005
BASE = f'http://localhost:{PORT}/api'
CS = os.environ.get('ZK_INV_TEST_DATABASE_URL', 'postgresql://postgres:zkpass@localhost:5433/zkinventory_test')
# The inventory service: its own database and port.
INV_CS = os.environ.get('ZK_INV_SVC_TEST_DATABASE_URL', 'postgresql://postgres:zkpass@localhost:5433/zkinventory_svc_test')
INV_PORT = 4006
TOKEN = 'e2e-service-token'


def call(method, path, body=None, token=None, raw=False):
    h = {'Content-Type': 'application/json'}
    if token:
        h['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(), headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
            if raw:
                return {'bytes': len(data), 'type': r.headers.get('Content-Type')}
            return json.loads(data) if data[:1] in (b'{', b'[') else {'raw': len(data)}
    except urllib.error.HTTPError as e:
        return {'error': json.loads(e.read()).get('error'), 'status': e.code}


def check(cond, what):
    print(('PASS ' if cond else 'FAIL ') + what)
    if not cond:
        raise SystemExit(1)


def ok(r, what):
    check(isinstance(r, list) or 'error' not in r, f'{what}' + ('' if isinstance(r, list) or 'error' not in r else f" ({r['error']})"))
    return r


def main():
    env = dict(os.environ, PORT=str(PORT), DATABASE_URL=CS, TZ='Asia/Kolkata', INVENTORY_URL=f'http://localhost:{INV_PORT}', SERVICE_TOKEN=TOKEN)
    inv_env = dict(os.environ, PORT=str(INV_PORT), DATABASE_URL=INV_CS, TZ='Asia/Kolkata', ATTENDANCE_URL=f'http://localhost:{PORT}', SERVICE_TOKEN=TOKEN)
    # Server output to a file: a full pipe nobody reads would block the server.
    log_path = os.path.join(os.environ.get('TEMP', '/tmp'), 'e2e_inventory_server.log')
    log = open(log_path, 'w', encoding='utf8')
    server = subprocess.Popen('npx tsx src/server.ts', cwd=os.path.join(ROOT, 'web', 'server'), env=env, shell=True,
                              stdout=log, stderr=subprocess.STDOUT, text=True)
    inventory = subprocess.Popen('npx tsx src/server.ts', cwd=os.path.join(ROOT, 'inventory-api'), env=inv_env, shell=True,
                                 stdout=log, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(80):
            try:
                call('GET', '/auth/status')
                urllib.request.urlopen(f'http://localhost:{INV_PORT}/health', timeout=5)
                break
            except Exception:
                time.sleep(0.5)
        # The inventory service only answers the attendance server (service token): direct calls are refused.
        try:
            urllib.request.urlopen(f'http://localhost:{INV_PORT}/api/inventory/items', timeout=10)
            check(False, 'inventory service refuses calls without the service token')
        except urllib.error.HTTPError as e:
            check(e.code == 401, 'inventory service refuses calls without the service token')
        try:
            urllib.request.urlopen(f'http://localhost:{PORT}/api/internal/directory', timeout=10)
            check(False, 'attendance /api/internal needs the service token')
        except urllib.error.HTTPError as e:
            check(e.code == 401, 'attendance /api/internal needs the service token')
        me = call('GET', '/auth/me')
        check('inventory' in me['permissions']['write'], 'SuperAdmin can change the inventory')

        # ---- shared masters from attendance: department and employees
        prod = ok(call('POST', '/departments', {'name': 'Production'}), 'department Production')['id']
        line = ok(call('POST', '/departments', {'name': 'Line 1', 'parentId': prod}), 'sub-department Line 1')['id']
        office = ok(call('POST', '/departments', {'name': 'Office'}), 'department Office')['id']
        shift = call('GET', '/shifts')[0]['Id']

        def emp(no, name, dept):
            return ok(call('POST', '/employees', {'EnrollNo': no, 'Name': name, 'DepartmentId': dept, 'ShiftId': shift, 'IsActive': True}), f'employee {no}')['id']
        e1, e2, e3 = emp('701', 'Ravi Worker', line), emp('702', 'Sita Operator', prod), emp('703', 'Office Clerk', office)
        lk = call('GET', '/inventory/lookups')
        check(len(lk['employees']) == 3 and any(d['Name'] == 'Line 1' for d in lk['departments']), 'inventory lookups use attendance employees and departments')
        store = lk['warehouses'][0]['Id']
        check(lk['warehouses'][0]['Name'] == 'Main Store' and len(lk['categories']) >= 5, 'seed: Main Store and categories')

        # ---- masters
        check(call('POST', '/inventory/suppliers', {'Name': 'Bad GST', 'Gstin': '12345'}).get('status') == 400, 'invalid GSTIN refused')
        sup = ok(call('POST', '/inventory/suppliers', {'Name': 'Sharma Traders', 'Gstin': '07ABCDE1234F1Z5', 'LeadTimeDays': 5}), 'supplier')['id']
        cat = lk['categories'][0]['Id']
        gloves = ok(call('POST', '/inventory/items', {'Name': 'Safety Gloves', 'CategoryId': cat, 'Unit': 'Pair', 'PurchasePrice': 100, 'GstRate': 12,
                                                     'ReorderLevel': 10, 'ReorderQty': 50, 'PreferredSupplierId': sup, 'OpeningQty': 20}), 'item with opening stock')['id']
        drill = ok(call('POST', '/inventory/items', {'Code': 'drl-01', 'Name': 'Cordless Drill', 'PurchasePrice': 6500, 'IsReturnable': True, 'ReturnDays': 7,
                                                    'OpeningQty': 3}), 'returnable item')['id']
        check(call('POST', '/inventory/items', {'Code': 'DRL-01', 'Name': 'Dup'}).get('status') == 400, 'duplicate item code refused')
        items = {i['Id']: i for i in call('GET', '/inventory/items')}
        check(items[gloves]['Code'] == 'ITM-0001' and items[gloves]['Qty'] == 20 and items[gloves]['Value'] == 2000, 'auto code ITM-0001, 20 pairs worth 2000')
        check(items[drill]['Code'] == 'DRL-01' and items[drill]['IsReturnable'], 'code upper case, returnable')

        # ---- issue → low stock → automatic draft PO
        ok(call('PUT', '/inventory/settings', {'AutoPO': 'draft', 'Approval': 'hod', 'AutoIssue': '0'}), 'settings saved')
        ok(call('POST', '/inventory/issues', {'EmployeeId': e1, 'WarehouseId': store, 'Lines': [{'ItemId': gloves, 'Qty': 15}]}), 'issue 15 pairs to 701')
        pos = call('GET', '/inventory/purchase-orders')
        check(len(pos) == 1 and pos[0]['IsAuto'] and pos[0]['Status'] == 'Draft', 'automatic draft PO made')
        po = call('GET', f"/inventory/purchase-orders/{pos[0]['Id']}")
        check(po['Lines'][0]['ItemId'] == gloves and po['Lines'][0]['Qty'] == 50 and po['Lines'][0]['UnitPrice'] == 100, 'PO line: 50 pairs at 100')
        al = call('GET', '/inventory/alerts')
        check(any(a['Kind'] == 'LowStock' for a in al['items']) and any(a['Kind'] == 'AutoPO' for a in al['items']), 'low stock + auto PO alerts')
        ok(call('POST', '/inventory/issues', {'EmployeeId': e1, 'WarehouseId': store, 'Lines': [{'ItemId': gloves, 'Qty': 2}]}), 'issue 2 more')
        check(len(call('GET', '/inventory/purchase-orders')) == 1, 'no second PO: the quantity on order counts')
        check(call('GET', f"/inventory/purchase-orders/{pos[0]['Id']}")['Lines'][0]['Qty'] == 50, 'draft PO not increased again')
        check(next(i for i in call('GET', '/inventory/items') if i['Id'] == gloves)['OnOrder'] == 50, 'items list shows 50 on order')
        r = call('POST', '/inventory/issues', {'EmployeeId': e1, 'WarehouseId': store, 'Lines': [{'ItemId': gloves, 'Qty': 10}]})
        check(r.get('status') == 400 and 'Not enough stock' in r['error'], 'issue above stock refused')
        issues = call('GET', '/inventory/issues')
        check(len(issues) == 2 and issues[0]['Department'] == 'Line 1', 'issue carries the employee\'s department')

        # ---- PO → receipts (weighted average), auto status
        poid = po['Id']
        check(call('POST', f'/inventory/purchase-orders/{poid}/receive', {'Lines': [{'LineId': po['Lines'][0]['Id'], 'Qty': 5}]}).get('status') == 400, 'draft cannot be received')
        ok(call('POST', f'/inventory/purchase-orders/{poid}/status', {'status': 'Ordered'}), 'PO ordered')
        ok(call('POST', f'/inventory/purchase-orders/{poid}/receive', {'InvoiceNo': 'INV-9', 'Lines': [{'LineId': po['Lines'][0]['Id'], 'Qty': 30, 'UnitPrice': 110}]}), 'receive 30 at 110')
        po = call('GET', f'/inventory/purchase-orders/{poid}')
        check(po['Status'] == 'Partial' and po['Lines'][0]['Pending'] == 20, 'PO partly received, 20 pending')
        g = next(i for i in call('GET', '/inventory/items') if i['Id'] == gloves)
        check(g['Qty'] == 33 and abs(g['AvgCost'] - 109.09) < 0.01, f"weighted average cost 109.09 ({g['AvgCost']})")
        check(call('POST', f'/inventory/purchase-orders/{poid}/receive', {'Lines': [{'LineId': po['Lines'][0]['Id'], 'Qty': 25}]}).get('status') == 400, 'over-receipt refused')
        ok(call('POST', f'/inventory/purchase-orders/{poid}/receive', {'Lines': [{'LineId': po['Lines'][0]['Id'], 'Qty': 20}]}), 'receive the rest')
        check(call('GET', f'/inventory/purchase-orders/{poid}')['Status'] == 'Received', 'PO fully received')
        check(not any(a['Kind'] == 'LowStock' for a in call('GET', '/inventory/alerts')['items']), 'low stock alert closed by the receipt')

        # ---- roles
        def user(name, role, dept=None):
            ok(call('POST', '/users', {'UserName': name, 'Role': role, 'Password': 'secret123', 'DepartmentId': dept}), f'user {name} ({role})')
            return call('POST', '/auth/login', {'user': name, 'password': 'secret123'})['token']
        sk, hr, hod = user('store1', 'StoreKeeper'), user('hr1', 'HR'), user('hodprod', 'HOD', prod)
        p = call('GET', '/auth/me', token=sk)['permissions']
        check(p['read'] == ['inventory'] and p['write'] == ['inventory'], 'StoreKeeper reads / writes only the inventory')
        check(call('GET', '/employees', token=sk).get('status') == 403 and call('GET', '/dashboard', token=sk).get('status') == 403, 'StoreKeeper: no attendance screens')
        check(len(call('GET', '/inventory/lookups', token=sk)['employees']) == 3, 'StoreKeeper still picks employees in the inventory')
        check(call('GET', '/inventory/items', token=hr).get('status') == 403, 'HR: no inventory')
        check(isinstance(call('GET', '/employees', token=hr), list), 'HR: attendance as before')
        check(call('POST', '/inventory/items', {'Name': 'x'}, token=hod).get('status') == 403, 'HOD cannot change items')

        # ---- requisition → HOD approval → issue
        rq = ok(call('POST', '/inventory/requisitions', {'EmployeeId': e2, 'WarehouseId': store, 'Purpose': 'Line maintenance',
                                                        'Lines': [{'ItemId': gloves, 'Qty': 6}]}, token=sk), 'requisition for 702')['id']
        check(call('GET', f'/inventory/requisitions/{rq}')['Status'] == 'Pending', 'requisition pending')
        hodlist = call('GET', '/inventory/requisitions', token=hod)
        check([x['Id'] for x in hodlist] == [rq], 'HOD sees the requisition of their department')
        rq_office = ok(call('POST', '/inventory/requisitions', {'EmployeeId': e3, 'WarehouseId': store, 'Lines': [{'ItemId': gloves, 'Qty': 1}]}), 'requisition for office')['id']
        check(call('POST', f'/inventory/requisitions/{rq_office}/decide', {'approve': True}, token=hod).get('status') == 403, 'HOD cannot decide another department')
        check(call('POST', f'/inventory/requisitions/{rq}/decide', {'approve': False}, token=hod).get('status') == 400, 'rejection needs a reason')
        ok(call('POST', f'/inventory/requisitions/{rq}/decide', {'approve': True, 'Lines': [{'LineId': call('GET', f'/inventory/requisitions/{rq}')['Lines'][0]['Id'], 'Qty': 4}]}, token=hod), 'HOD approves 4 of 6')
        ok(call('POST', f'/inventory/requisitions/{rq}/issue', {}, token=sk), 'store issues the requisition')
        r = call('GET', f'/inventory/requisitions/{rq}')
        check(r['Status'] == 'Issued' and r['Lines'][0]['IssuedQty'] == 4, 'requisition issued (4)')
        ok(call('POST', f'/inventory/requisitions/{rq_office}/decide', {'approve': False, 'note': 'Not needed'}), 'admin rejects office requisition')

        # ---- employee portal: request with approval off and auto issue on
        acc = call('POST', '/portal-admin/accounts', {'ids': [e2]})['accounts'][0]
        pt = call('POST', '/portal/login', {'enrollNo': '702', 'password': acc['Password']})['token']
        cat_ = call('GET', '/portal/store/catalog', token=pt)
        check(any(i['Id'] == gloves and i['InStock'] for i in cat_['items']) and 'AvgCost' not in cat_['items'][0], 'portal catalog without costs')
        ok(call('PUT', '/inventory/settings', {'Approval': 'none', 'AutoIssue': '1'}), 'approval off, auto issue on')
        ok(call('POST', '/portal/store/requisitions', {'Purpose': 'Night shift', 'Lines': [{'ItemId': gloves, 'Qty': 2}]}, token=pt), 'employee asks in the portal')
        mine = call('GET', '/portal/store/requisitions', token=pt)
        check(mine[0]['Status'] == 'Issued' and mine[0]['Lines'][0]['IssuedQty'] == 2, 'approved and issued automatically')
        ok(call('PUT', '/inventory/settings', {'Approval': 'hod', 'AutoIssue': '1'}), 'approval back on')
        big = ok(call('POST', '/portal/store/requisitions', {'Lines': [{'ItemId': gloves, 'Qty': 500}]}, token=pt), 'employee asks for more than in stock')['id']
        ok(call('POST', f'/inventory/requisitions/{big}/decide', {'approve': True}), 'approved (not enough stock: waits)')
        check(call('GET', f'/inventory/requisitions/{big}')['Status'] == 'Approved', 'waiting for stock')
        ok(call('POST', '/inventory/receipts', {'SupplierId': sup, 'WarehouseId': store, 'InvoiceNo': 'CASH-1', 'Lines': [{'ItemId': gloves, 'Qty': 500, 'UnitPrice': 95}]}), 'receipt without PO')
        check(call('GET', f'/inventory/requisitions/{big}')['Status'] == 'Issued', 'goods arrived -> waiting requisition issued automatically')
        ok(call('PUT', '/inventory/settings', {'AutoIssue': '0'}), 'auto issue off')

        # ---- returnable: overdue reminder, return, exit clearance
        past = (date.today() - timedelta(days=3)).isoformat()
        iss = ok(call('POST', '/inventory/issues', {'EmployeeId': e1, 'WarehouseId': store, 'Lines': [{'ItemId': drill, 'Qty': 2, 'DueDate': past}]}), 'drills to 701, due 3 days ago')['id']
        res = ok(call('POST', '/inventory/automation/run'), 'daily checks')
        check(res['overdue'] == 1 and res['reminded'] == 1, 'overdue found, employee reminded')
        check(call('POST', '/inventory/automation/run')['reminded'] == 0, 'no second reminder the same day')
        hold = call('GET', '/inventory/holdings')
        check(len(hold) == 1 and hold[0]['OverdueDays'] == 3 and hold[0]['Qty'] == 2, 'holdings: 2 drills, 3 days late')
        lid = hold[0]['LineId']
        ok(call('POST', f'/inventory/issues/{iss}/return', {'Lines': [{'LineId': lid, 'Qty': 1, 'Condition': 'Good'}]}), 'one drill back')
        check(next(i for i in call('GET', '/inventory/items') if i['Id'] == drill)['Qty'] == 2, 'drill stock back to 2')
        d = call('GET', f'/employees/{e1}')
        ok(call('PUT', f'/employees/{e1}', {k: d[k] for k in ('EnrollNo', 'Name', 'DepartmentId', 'ShiftId')} | {'IsActive': False}), '701 leaves (inactive in attendance)')
        call('POST', '/inventory/automation/run')
        check(any(a['Kind'] == 'ExitClearance' for a in call('GET', '/inventory/alerts')['items']), 'exit clearance alert')
        ok(call('POST', f'/inventory/issues/{iss}/return', {'Lines': [{'LineId': lid, 'Qty': 1, 'Condition': 'Lost'}]}), 'last drill written off as lost')
        al = call('GET', '/inventory/alerts')['items']
        check(not any(a['Kind'] in ('ExitClearance', 'Overdue') for a in al), 'exit clearance + overdue closed')

        # ---- transfer, stock count, adjustment
        site = ok(call('POST', '/inventory/warehouses', {'Name': 'Site Store'}), 'second store')['id']
        ok(call('POST', '/inventory/stock/transfer', {'FromWarehouseId': store, 'ToWarehouseId': site, 'Lines': [{'ItemId': gloves, 'Qty': 10}]}), 'transfer 10 to site')
        check(next(i for i in call(f'GET', f'/inventory/items?warehouse={site}') if i['Id'] == gloves)['Qty'] == 10, 'site store has 10')
        ok(call('POST', '/inventory/stock/count', {'WarehouseId': site, 'Lines': [{'ItemId': gloves, 'Counted': 8}]}), 'stock count: 8 found')
        check(next(i for i in call(f'GET', f'/inventory/items?warehouse={site}') if i['Id'] == gloves)['Qty'] == 8, 'count corrected the stock to 8')
        check(call('POST', '/inventory/stock/adjust', {'WarehouseId': site, 'Lines': [{'ItemId': gloves, 'Qty': -1}]}).get('status') == 400, 'adjustment needs a reason')
        ok(call('POST', '/inventory/stock/adjust', {'WarehouseId': site, 'Reason': 'Torn', 'Lines': [{'ItemId': gloves, 'Qty': -1}]}), 'adjustment -1')
        check(call('PUT', f'/inventory/warehouses/{site}', {'Name': 'Site Store', 'IsActive': False}).get('status') == 400, 'store with stock cannot be switched off')
        check(len(call('GET', '/inventory/stock/documents')) == 3, 'transfer, count, adjustment listed')

        # ---- work sites: material issued for a site, installed there, left-overs back, portal, register
        ws = ok(call('POST', '/sites', {'Name': 'Tower A', 'Latitude': 28.61, 'Longitude': 77.21, 'RadiusMeters': 200, 'AllEmployees': True, 'IsActive': True}), 'work site Tower A')['id']
        check(any(x['Id'] == ws for x in call('GET', '/inventory/lookups')['sites']), 'inventory lookups list the work sites')
        gl0 = next(i for i in call('GET', '/inventory/items') if i['Id'] == gloves)['Qty']
        si = ok(call('POST', '/inventory/issues', {'EmployeeId': e2, 'WarehouseId': store, 'SiteId': ws, 'Lines': [{'ItemId': gloves, 'Qty': 20}, {'ItemId': drill, 'Qty': 1}]}, token=sk),
                'store issues 20 gloves + 1 drill to 702 for Tower A')['id']
        sl = call('GET', f'/inventory/issues?site={ws}')
        check(len(sl) == 1 and sl[0]['Site'] == 'Tower A' and sl[0]['ForSite'] and sl[0]['AtSite'], 'issue list filters by site, material at site')
        gl_line = next(l for l in sl[0]['Lines'] if l['ItemId'] == gloves)['Id']
        dr_line = next(l for l in sl[0]['Lines'] if l['ItemId'] == drill)['Id']
        st = {r['ItemId']: r for r in call('GET', f'/inventory/sites/stock?site={ws}')}
        check(st[gloves]['AtSite'] == 20 and st[drill]['AtSite'] == 1, 'site stock: 20 gloves, 1 drill at Tower A')
        ok(call('POST', f'/inventory/issues/{si}/consume', {'Note': 'Floor 2', 'Lines': [{'LineId': gl_line, 'Qty': 15}]}, token=sk), 'store marks 15 gloves installed')
        check(call('POST', f'/inventory/issues/{si}/consume', {'Lines': [{'LineId': gl_line, 'Qty': 6}]}).get('status') == 400, 'cannot install more than is at the site')
        future = (date.today() + timedelta(days=2)).isoformat()
        check(call('POST', f'/inventory/issues/{si}/consume', {'UsedOn': future, 'Lines': [{'LineId': gl_line, 'Qty': 1}]}).get('status') == 400, 'installed date cannot be in the future')
        check(call('POST', f'/inventory/issues/{si}/return', {'Lines': [{'LineId': gl_line, 'Qty': 6, 'Condition': 'Good'}]}).get('status') == 400, 'cannot return what was installed')
        ok(call('POST', f'/inventory/issues/{si}/return', {'Lines': [{'LineId': gl_line, 'Qty': 5, 'Condition': 'Good'}]}, token=sk), '5 left-over gloves back to the store')
        check(next(i for i in call('GET', '/inventory/items') if i['Id'] == gloves)['Qty'] == gl0 - 15, 'store stock: only the 15 installed gloves are gone')
        st = {r['ItemId']: r for r in call('GET', f'/inventory/sites/stock?site={ws}')}
        check(st[gloves]['Installed'] == 15 and st[gloves]['Returned'] == 5 and st[gloves]['AtSite'] == 0 and st[gloves]['InstalledValue'] > 0, 'site stock: 15 installed, 5 returned, 0 left')
        check(gloves not in {r['ItemId'] for r in call('GET', f'/inventory/sites/stock?site={ws}&open=1')}, 'open-only hides what is no longer at the site')
        check(any(h['LineId'] == dr_line and h['Site'] == 'Tower A' for h in call('GET', f'/inventory/holdings?employee={e2}')), 'drill at the site is still held by 702')
        # portal / app
        cat_ = call('GET', '/portal/store/catalog', token=pt)
        check(any(x['Id'] == ws for x in cat_['sites']), "portal catalog lists the employee's work sites")
        mat = call('GET', '/portal/store/site-material', token=pt)
        check(len(mat) == 1 and mat[0]['Site'] == 'Tower A' and [l['LineId'] for l in mat[0]['Lines']] == [dr_line], 'portal: material at site (the drill)')
        ok(call('POST', f'/portal/store/issues/{si}/consume', {'Lines': [{'LineId': dr_line, 'Qty': 1}]}, token=pt), 'employee marks the drill installed from the portal')
        check(call('GET', '/portal/store/site-material', token=pt) == [], 'portal: nothing left at the site')
        check(not any(h['LineId'] == dr_line for h in call('GET', '/inventory/holdings')), 'installed drill no longer held')
        other = ok(call('POST', '/inventory/issues', {'EmployeeId': e3, 'WarehouseId': store, 'SiteId': ws, 'Lines': [{'ItemId': gloves, 'Qty': 2}]}), 'gloves to 703 for Tower A')['id']
        ol = call('GET', f'/inventory/issues?employee={e3}&site={ws}')[0]['Lines'][0]['Id']
        check(call('POST', f'/portal/store/issues/{other}/consume', {'Lines': [{'LineId': ol, 'Qty': 1}]}, token=pt).get('status') == 404, "portal: not on another employee's issue")
        plain = ok(call('POST', '/inventory/issues', {'EmployeeId': e3, 'WarehouseId': store, 'Lines': [{'ItemId': gloves, 'Qty': 1}]}), 'gloves to 703, no site')['id']
        pline = next(i for i in call('GET', f'/inventory/issues?employee={e3}') if i['Id'] == plain)['Lines'][0]['Id']
        check(call('POST', f'/inventory/issues/{plain}/consume', {'Lines': [{'LineId': pline, 'Qty': 1}]}).get('status') == 400, 'installed only on a site issue')
        # a requisition for a site keeps the site on its issue
        rqs = ok(call('POST', '/portal/store/requisitions', {'SiteId': ws, 'Purpose': 'Wiring', 'Lines': [{'ItemId': gloves, 'Qty': 3}]}, token=pt), 'employee asks for material for Tower A')['id']
        check(call('GET', '/portal/store/requisitions', token=pt)[0]['Site'] == 'Tower A', 'portal request shows the site')
        ok(call('POST', f'/inventory/requisitions/{rqs}/decide', {'approve': True}), 'site requisition approved')
        ok(call('POST', f'/inventory/requisitions/{rqs}/issue', {}), 'site requisition issued')
        check(any(i['RequisitionId'] == rqs and i['Site'] == 'Tower A' for i in call('GET', f'/inventory/issues?site={ws}')), 'issue of the requisition is for Tower A')
        reg = call('GET', f'/inventory/sites/register?site={ws}')
        check({r['Kind'] for r in reg} == {'Issued', 'Installed', 'Returned'} and any(r['Note'] == 'Floor 2' for r in reg), 'site register: issued, installed, returned')
        ok(call('PUT', f'/sites/{ws}', {'Name': 'Tower A', 'Latitude': 28.61, 'Longitude': 77.21, 'RadiusMeters': 200, 'AllEmployees': True, 'IsActive': False}), 'Tower A switched off')
        check(call('POST', '/inventory/issues', {'EmployeeId': e3, 'WarehouseId': store, 'SiteId': ws, 'Lines': [{'ItemId': gloves, 'Qty': 1}]}).get('status') == 400, 'no new issue for an inactive site')
        check(len(call('GET', f'/inventory/sites/stock?site={ws}')) == 2, 'inactive site keeps its material history')

        # ---- reports
        today = date.today().isoformat()
        first = date.today().replace(day=1).isoformat()
        for rep in call('GET', '/inventory/reports'):
            r = call('GET', f"/inventory/reports/{rep['key']}?from={first}&to={today}")
            check('columns' in r and isinstance(r['rows'], list), f"report {rep['key']}: {len(r.get('rows', []))} row(s)")
        cons = call('GET', f'/inventory/reports/consumption?from={first}&to={today}&department={prod}')
        check(any(row[0] == 'Line 1' for row in cons['rows']), 'consumption of Production includes sub-department Line 1')
        f = call('GET', f'/inventory/reports/stock/file?format=xlsx', raw=True)
        check(f['bytes'] > 1000 and 'spreadsheet' in f['type'], 'stock summary Excel')
        f = call('GET', f'/inventory/reports/stock/file?format=pdf', raw=True)
        check(f['bytes'] > 1000 and 'pdf' in f['type'], 'stock summary PDF')
        dash = ok(call('GET', '/inventory/dashboard', token=sk), 'dashboard (StoreKeeper)')
        check(dash['cards']['items'] == 2 and dash['cards']['value'] > 0 and dash['cards']['monthOut'] > 0 and dash['cards']['monthIn'] > 0, 'dashboard cards (month in / out)')

        site_rep = call('GET', f'/inventory/reports/site-register?from={first}&to={today}&site={ws}')
        check(len(site_rep['rows']) >= 5, 'site register report')
        ok(call('DELETE', f'/sites/{ws}'), 'attendance deletes work site Tower A')
        check(next(i for i in call('GET', f'/inventory/issues?employee={e3}') if i['Id'] == other)['Site'] == 'Tower A', 'issue keeps the name of the deleted site')
        check(any(r['Site'] == 'Tower A' for r in call('GET', '/inventory/sites/stock')), 'site stock keeps the deleted site by name')

        # ---- serial / tagged units (RFID / QR), scanning, employee bins with a limit
        plaza = ok(call('POST', '/sites', {'Name': 'Plaza Mall', 'Latitude': 19.07, 'Longitude': 72.87, 'RadiusMeters': 300, 'AllEmployees': True, 'IsActive': True}), 'work site Plaza Mall')['id']
        bb = ok(call('POST', '/inventory/items', {'Code': 'BB-6M', 'Name': 'Boom Barrier 6 m', 'PurchasePrice': 85000, 'TrackBy': 'Serial', 'OpeningQty': 3, 'OpeningWarehouseId': store}, token=sk),
                'serial item Boom Barrier with 3 in stock')['id']
        us = call('GET', f'/inventory/units?item={bb}')
        check(len(us) == 3 and all(u['Status'] == 'InStore' and u['SerialNo'].startswith('BB-6M-') for u in us), '3 units numbered automatically, in store')
        check(next(i for i in call('GET', '/inventory/lookups')['items'] if i['Id'] == bb)['TrackBy'] == 'Serial', 'lookups: tracked by serial')
        t1 = ok(call('POST', '/inventory/units/tag-next', {'ItemId': bb, 'Tag': 'RFID-0001'}, token=sk), 'RFID tag on the next unit')
        t2 = ok(call('POST', '/inventory/units/tag-next', {'ItemId': bb, 'Tag': 'rfid-0002'}, token=sk), 'second tag')
        check(t1['Tag'] == 'RFID-0001' and t2['Id'] != t1['Id'], 'tags go on different units')
        check(call('POST', '/inventory/units/tag-next', {'ItemId': bb, 'Tag': 'RFID-0002'}).get('status') == 400, 'a tag is used once (any case)')
        ok(call('PUT', f"/inventory/units/{t1['Id']}", {'SerialNo': 'MFR-BB-7781'}, token=sk), 'manufacturer serial on unit 1')
        u1, u2 = t1['Id'], t2['Id']
        u3 = next(u['Id'] for u in us if u['Id'] not in (u1, u2))
        sc_ = call('GET', '/inventory/scan?code=rfid-0001')
        check(sc_['kind'] == 'unit' and sc_['unit']['Id'] == u1 and sc_['unit']['SerialNo'] == 'MFR-BB-7781', 'scan: RFID tag -> unit')
        check(call('GET', '/inventory/scan?code=MFR-BB-7781')['unit']['Id'] == u1, 'scan: serial number -> unit')
        check(call('GET', '/inventory/scan?code=drl-01')['kind'] == 'item', 'scan: item code -> item')
        check(call('GET', '/inventory/scan?code=BIN-703')['employee']['Id'] == e3, 'scan: bin code -> employee')
        check(call('GET', '/inventory/scan?code=nothing-here').get('status') == 404, 'scan: unknown code')
        check(call('POST', '/inventory/issues', {'EmployeeId': e3, 'WarehouseId': store, 'Lines': [{'ItemId': bb, 'Qty': 1.5}]}).get('status') == 400, 'serial items in whole units')

        # bin limit 3 (setting); 703 already holds 1 entry (gloves at the deleted-site issue? no: still open at Tower A)
        ok(call('PUT', '/inventory/settings', {'BinLimit': '3'}), 'bin limit 3 for everybody')
        b3 = call('GET', f'/inventory/bins/{e3}')
        start = b3['Open']
        check(b3['Bin'] == 'BIN-703' and b3['Limit'] == 3 and start == 1, f"bin of 703: {start} open of 3")
        iss_bb = ok(call('POST', '/inventory/issues', {'EmployeeId': e3, 'WarehouseId': store, 'Lines': [{'ItemId': bb, 'Qty': 2, 'Units': [u1, u2]}]}, token=sk),
                    'two scanned barriers to 703')['id']
        check(call('GET', f'/inventory/units/{u1}')['Status'] == 'Issued' and call('GET', f'/inventory/units/{u1}')['EmployeeId'] == e3, 'unit 1 issued to 703')
        r = call('POST', '/inventory/issues', {'EmployeeId': e3, 'WarehouseId': store, 'Lines': [{'ItemId': drill, 'Qty': 1}]})
        check(r.get('status') == 400 and 'full' in r['error'], 'bin full: no more issues to 703')
        check(call('POST', '/inventory/requisitions', {'EmployeeId': e3, 'Lines': [{'ItemId': drill, 'Qty': 1}]}).get('status') == 400, 'bin full: no new request either')
        ok(call('POST', '/inventory/issues', {'EmployeeId': e3, 'WarehouseId': store, 'Lines': [{'ItemId': gloves, 'Qty': 1}]}), 'consumables do not need room in the bin')
        b3 = call('GET', f'/inventory/bins/{e3}')
        check(b3['Open'] == 3 and b3['Full'], 'bin: 3 of 3, full')
        bbl = next(l for l in b3['Lines'] if l['ItemId'] == bb)
        check(bbl['Kind'] == 'Serial' and sorted(u['Id'] for u in bbl['Units']) == sorted([u1, u2]), 'bin lists the units with serials')
        check(any(b['EmployeeId'] == e3 and b['Full'] for b in call('GET', '/inventory/bins?open=1')), 'bins list shows 703 full')
        check(call('GET', '/inventory/bins?q=BIN-703')[0]['EmployeeId'] == e3, 'bins search by bin code')
        check(call('POST', '/inventory/issues', {'EmployeeId': e2, 'WarehouseId': store, 'Lines': [{'ItemId': bb, 'Qty': 1, 'Units': [u1]}]}).get('status') == 400, 'a unit out with 703 cannot be issued again')
        ok(call('PUT', f'/inventory/bins/{e3}', {'MaxItems': 5, 'Note': 'Senior technician'}, token=sk), 'own limit 5 for 703')
        dr = ok(call('POST', '/inventory/issues', {'EmployeeId': e3, 'WarehouseId': store, 'Lines': [{'ItemId': drill, 'Qty': 1}]}), 'drill to 703 now fits')['id']

        # giving back by scanning
        rr = ok(call('POST', '/inventory/scan/return', {'Code': 'RFID-0001'}, token=sk), 'scan return of unit 1')
        check('back from 703' in rr['message'] and call('GET', f'/inventory/units/{u1}')['Status'] == 'InStore', 'unit 1 back in the store')
        check(call('POST', '/inventory/scan/return', {'Code': 'RFID-0001'}).get('status') == 400, 'a unit in the store cannot come back twice')
        check(call('POST', '/inventory/scan/return', {'Code': 'DRL-01'}).get('status') == 400, 'quantity item needs the bin first')
        ok(call('POST', '/inventory/scan/return', {'Code': 'DRL-01', 'EmployeeId': e3, 'Qty': 1}, token=sk), 'drill back from bin 703 by scanning')
        ln2 = next(l for l in call('GET', f'/inventory/bins/{e3}')['Lines'] if l['ItemId'] == bb)['LineId']
        bb_stock = next(i for i in call('GET', '/inventory/items') if i['Id'] == bb)['Qty']
        ok(call('POST', f'/inventory/issues/{iss_bb}/return', {'Lines': [{'LineId': ln2, 'Units': [u2], 'Condition': 'Damaged'}]}, token=sk), 'unit 2 comes back damaged')
        check(call('GET', f'/inventory/units/{u2}')['Status'] == 'Damaged' and next(i for i in call('GET', '/inventory/items') if i['Id'] == bb)['Qty'] == bb_stock,
              'damaged unit not back in stock')
        ev = [e['Event'] for e in call('GET', f'/inventory/units/{u1}')['Events']]
        check(ev[:2] == ['Returned', 'Issued'] and 'Tagged' in ev and 'Opening' in ev, f'unit history: {ev}')
        check(call('GET', f'/inventory/bins/{e3}')['Open'] == 1, 'bin of 703 back to 1 open')

        # transfer moves the chosen unit; installed at a site from the portal
        sstore = next(w['Id'] for w in call('GET', '/inventory/lookups')['warehouses'] if w['Name'] == 'Site Store')
        ok(call('POST', '/inventory/stock/transfer', {'FromWarehouseId': store, 'ToWarehouseId': sstore, 'Lines': [{'ItemId': bb, 'Qty': 1, 'Units': [u3]}]}), 'transfer unit 3 to Site Store')
        check(call('GET', f'/inventory/units/{u3}')['WarehouseId'] == sstore, 'unit 3 is in Site Store')
        isp = ok(call('POST', '/inventory/issues', {'EmployeeId': e2, 'WarehouseId': store, 'SiteId': plaza, 'Lines': [{'ItemId': bb, 'Qty': 1}]}), 'barrier for Plaza Mall to 702 (oldest unit)')['id']
        check(call('GET', f'/inventory/units/{u1}')['Status'] == 'Issued' and call('GET', f'/inventory/units/{u1}')['Site'] == 'Plaza Mall', 'unit 1 picked automatically, for Plaza Mall')
        pb = call('GET', '/portal/store/bin', token=pt)
        check(pb['Bin'] == 'BIN-702' and 'UnitCost' not in pb['Lines'][0] and 'OpenValue' not in pb['Totals'], 'portal: own bin without costs')
        mat = call('GET', '/portal/store/site-material', token=pt)
        ln = next(l for d in mat if d['Id'] == isp for l in d['Lines'])['LineId']
        ok(call('POST', f'/portal/store/issues/{isp}/consume', {'Lines': [{'LineId': ln, 'Qty': 1}]}, token=pt), 'employee marks the barrier installed')
        u1d = call('GET', f'/inventory/units/{u1}')
        check(u1d['Status'] == 'Installed' and u1d['Site'] == 'Plaza Mall' and u1d['EmployeeId'] is None, 'unit 1 installed at Plaza Mall')
        check(call('GET', '/inventory/scan?code=rfid-0001')['unit']['Status'] == 'Installed', 'scanning it later shows where it is installed')

        # switching to serial, receipts with serials, no way back
        lap = ok(call('POST', '/inventory/items', {'Code': 'LAP-14', 'Name': 'Laptop 14 inch', 'PurchasePrice': 52000, 'IsReturnable': True, 'OpeningQty': 2, 'OpeningWarehouseId': store}), 'laptop by quantity')['id']
        li = call('GET', f'/inventory/items/{lap}')
        ok(call('PUT', f'/inventory/items/{lap}', {k: li[k] for k in ('Code', 'Name', 'PurchasePrice', 'IsReturnable')} | {'TrackBy': 'Serial'}), 'laptop switched to serial')
        check(len(call('GET', f'/inventory/units?item={lap}')) == 2, 'its 2 in stock became units')
        ok(call('POST', '/inventory/receipts', {'SupplierId': sup, 'WarehouseId': store, 'Lines': [{'ItemId': lap, 'Qty': 1, 'UnitPrice': 51000, 'Serials': [{'SerialNo': 'SN-LAP-9', 'Tag': 'QR-LAP-9'}]}]}),
           'laptop received with its serial and QR')
        check(call('GET', '/inventory/scan?code=QR-LAP-9')['unit']['SerialNo'] == 'SN-LAP-9', 'received unit has serial + QR')
        li = call('GET', f'/inventory/items/{lap}')
        check(call('PUT', f'/inventory/items/{lap}', {k: li[k] for k in ('Code', 'Name', 'PurchasePrice')} | {'TrackBy': 'Qty'}).get('status') == 400, 'serial item cannot go back to quantity')
        gi = call('GET', f'/inventory/items/{gloves}')
        check(call('PUT', f'/inventory/items/{gloves}', {k: gi[k] for k in ('Code', 'Name', 'PurchasePrice')} | {'TrackBy': 'Serial'}).get('status') == 400,
              'item still out at a site cannot switch to serial')
        ok(call('PUT', f'/inventory/items/{drill}', {'Code': 'DRL-01', 'Name': 'Cordless Drill', 'PurchasePrice': 6500, 'IsReturnable': True, 'ReturnDays': 7, 'Barcode': '8901234567890'}), 'barcode on the drill')
        check(call('GET', '/inventory/scan?code=8901234567890')['item']['Id'] == drill, 'scan: pack barcode -> item')
        cnt = call('POST', '/inventory/stock/count', {'WarehouseId': store, 'Lines': [{'ItemId': lap, 'Counted': 2}]})
        check('error' not in cnt and sum(1 for u in call('GET', f'/inventory/units?item={lap}') if u['Status'] == 'Scrapped') == 1, 'stock count 3 -> 2 scraps one unit')
        for key in ('bins', 'units'):
            rp = call('GET', f'/inventory/reports/{key}')
            check(len(rp.get('rows', [])) > 0, f"report {key}: {len(rp.get('rows', []))} row(s)")
        ok(call('PUT', '/inventory/settings', {'BinLimit': '0'}), 'bin limit off again')

        # ---- locations: rack / row / column, RECEIVING, put-away, pick from a location, counts per location
        def books_match(what):
            bad = []
            for it in call('GET', '/inventory/items?inactive=1'):
                where = call('GET', f"/inventory/locations/where?item={it['Id']}")
                for st in it['Stores']:
                    on_locs = round(sum(x['Qty'] for x in where if x['WarehouseId'] == st['WarehouseId']), 3)
                    if abs(on_locs - st['Qty']) > 1e-6:
                        bad.append(f"{it['Code']}@{st['WarehouseId']}: store {st['Qty']} / locations {on_locs}")
                units_in = [u for u in call('GET', f"/inventory/units?item={it['Id']}&status=InStore")]
                if it.get('TrackBy') == 'Serial':
                    for x in where:
                        if len(x['Units']) != x['Qty']:
                            bad.append(f"{it['Code']} at {x['Code']}: {x['Qty']} in books, {len(x['Units'])} unit(s)")
                    if any(not u['LocationId'] for u in units_in):
                        bad.append(f"{it['Code']}: unit in store without location")
            check(not bad, f'{what}: every store quantity is on its locations' + (f' {bad}' if bad else ''))

        lk = call('GET', '/inventory/lookups')
        recv = next(l['Id'] for l in lk['locations'] if l['WarehouseId'] == store and l['IsSystem'])
        books_match('existing stock moved to RECEIVING')
        check(all(x['Code'] == 'RECEIVING' for x in call('GET', f'/inventory/locations/where?item={gloves}') if x['WarehouseId'] == store), 'old gloves stock is on RECEIVING')
        ok(call('POST', '/inventory/locations/rack', {'WarehouseId': store, 'Rack': 'r1', 'Rows': 2, 'Cols': 3}, token=sk), 'rack R1: 2 rows x 3 columns')
        check('0 new' in call('POST', '/inventory/locations/rack', {'WarehouseId': store, 'Rack': 'R1', 'Rows': 2, 'Cols': 3})['message'], 'making it again adds nothing')
        locs = {l['Code']: l['Id'] for l in call('GET', f'/inventory/locations?warehouse={store}')}
        check({'R1-1-1', 'R1-2-3', 'RECEIVING'} <= set(locs), 'locations R1-1-1 … R1-2-3')
        r111, r112, r121, r123 = locs['R1-1-1'], locs['R1-1-2'], locs['R1-2-1'], locs['R1-2-3']
        ok(call('POST', '/inventory/locations/move', {'ToLocationId': r111, 'Lines': [{'ItemId': gloves, 'Qty': 10}]}, token=sk), 'put away 10 gloves to R1-1-1')
        check(any(x['Code'] == 'R1-1-1' and x['Qty'] == 10 for x in call('GET', f'/inventory/locations/where?item={gloves}')), 'gloves: 10 at R1-1-1')
        lap_unit = next(u for u in call('GET', f'/inventory/units?item={lap}&status=InStore'))
        ok(call('POST', '/inventory/locations/move', {'ToLocationId': r112, 'Lines': [{'Units': [lap_unit['Id']]}]}, token=sk), 'laptop unit put away by scanning it')
        lu = call('GET', f"/inventory/units/{lap_unit['Id']}")
        check(lu['Location'] == 'R1-1-2' and lu['Events'][0]['Event'] == 'Moved' and lu['Events'][0]['Location'] == 'R1-1-2', 'unit is at R1-1-2, history says Moved')
        check(call('GET', f'/inventory/scan?code=LOC-{r111}')['location']['Code'] == 'R1-1-1', 'scan: location QR label')
        ok(call('PUT', f'/inventory/locations/{r111}', {'Tag': 'RFID-RACK-111'}), 'RFID tag on R1-1-1')
        check(call('GET', '/inventory/scan?code=rfid-rack-111')['location']['Id'] == r111, 'scan: location RFID tag')
        check(call('PUT', f'/inventory/locations/{r112}', {'Tag': 'RFID-0001'}).get('status') == 400, 'a unit tag cannot go on a location')
        gi = ok(call('POST', '/inventory/issues', {'EmployeeId': e3, 'WarehouseId': store, 'LocationId': r111, 'Lines': [{'ItemId': gloves, 'Qty': 3}]}, token=sk), '3 gloves picked from R1-1-1')['id']
        gl = next(i for i in call(f'GET', f'/inventory/issues?employee={e3}') if i['Id'] == gi)['Lines'][0]
        check(gl['PickedFrom'] == 'R1-1-1 ×3', f"issue line shows where it was picked: {gl['PickedFrom']}")
        r = call('POST', '/inventory/issues', {'EmployeeId': e3, 'WarehouseId': store, 'LocationId': r111, 'Lines': [{'ItemId': gloves, 'Qty': 10}]})
        check(r.get('status') == 400 and 'R1-1-1' in r['error'], f"not enough at R1-1-1: {r}")
        ok(call('POST', '/inventory/receipts', {'SupplierId': sup, 'WarehouseId': store, 'LocationId': r121, 'Lines': [{'ItemId': drill, 'Qty': 2, 'UnitPrice': 6400}]}), '2 drills received straight onto R1-2-1')
        check(any(x['Code'] == 'R1-2-1' and x['Qty'] == 2 for x in call('GET', f'/inventory/locations/where?item={drill}')), 'drills on R1-2-1')
        di = ok(call('POST', '/inventory/issues', {'EmployeeId': e3, 'WarehouseId': store, 'LocationId': r121, 'Lines': [{'ItemId': drill, 'Qty': 1}]}), 'drill from R1-2-1')['id']
        dl = next(i for i in call('GET', f'/inventory/issues?employee={e3}') if i['Id'] == di)['Lines'][0]['Id']
        ok(call('POST', f'/inventory/issues/{di}/return', {'LocationId': r123, 'Lines': [{'LineId': dl, 'Qty': 1, 'Condition': 'Good'}]}), 'drill back onto R1-2-3')
        check(any(x['Code'] == 'R1-2-3' and x['Qty'] == 1 for x in call('GET', f'/inventory/locations/where?item={drill}')), 'returned drill is on R1-2-3')
        gl_store = next(i for i in call('GET', '/inventory/items') if i['Id'] == gloves)['Qty']
        ok(call('POST', '/inventory/stock/count', {'WarehouseId': store, 'LocationId': r111, 'Lines': [{'ItemId': gloves, 'Counted': 6}]}), 'count at R1-1-1: 6 found (books 7)')
        check(next(i for i in call('GET', '/inventory/items') if i['Id'] == gloves)['Qty'] == gl_store - 1, 'store stock corrected by the location count')
        loc = call('GET', f'/inventory/locations/{r111}')
        check(loc['Label'] == f'LOC-{r111}' and loc['Items'][0]['Qty'] == 6, 'location card: 6 gloves')
        check(call('PUT', f'/inventory/locations/{r111}', {'IsActive': False}).get('status') == 400, 'a location with goods cannot be switched off')
        check(call('DELETE', f'/inventory/locations/{r111}').get('status') == 400, 'a location with history cannot be deleted')
        ok(call('DELETE', f"/inventory/locations/{locs['R1-2-2']}"), 'empty unused location deleted')
        pa = call('GET', '/inventory/locations/put-away')
        check(any(x['WarehouseId'] == store and x['Qty'] > 0 for x in pa), 'put-away list: goods still on RECEIVING')
        check(len(call('GET', '/inventory/reports/locations').get('rows', [])) > 0, 'report: stock by location')
        mv = call('GET', f'/inventory/reports/movement?from={date.today().replace(day=1).isoformat()}&to={date.today().isoformat()}')
        check('error' not in mv, 'movement report still works with moves')
        books_match('after put-away, picks, returns and counts')

        # ---- attendance deletes an employee: inventory history stays
        ok(call('POST', '/employees/delete', {'ids': [e2]}), 'delete employee 702 in attendance')
        r = call('GET', f'/inventory/requisitions/{rq}')
        check(r['Employee'] == 'Sita Operator' and r['EmployeeId'] is None, 'requisition keeps the name of the deleted employee')

        b = call('GET', '/settings/backup', raw=True)
        check(b['bytes'] > 0, 'attendance backup downloads')
        b = call('GET', '/inventory/backup', raw=True)
        check(b['bytes'] > 1000 and 'json' in (b['type'] or ''), 'inventory backup downloads (its own database)')
        check(call('GET', '/inventory/backup', token=sk).get('status') == 403, 'inventory backup: SuperAdmin only')
        print('\nALL INVENTORY TESTS PASSED')
    finally:
        for proc, port in ((server, PORT), (inventory, INV_PORT)):
            proc.terminate()
            if os.name == 'nt':
                subprocess.run(f'taskkill /F /T /PID {proc.pid}', shell=True, capture_output=True)
                # npx may leave the node process running: stop whatever still listens on the test port.
                subprocess.run(['powershell', '-NoProfile', '-Command',
                                f'Get-NetTCPConnection -LocalPort {port} -State Listen -EA SilentlyContinue | % {{ Stop-Process -Id $_.OwningProcess -Force }}'],
                               capture_output=True)
        log.close()
        out = open(log_path, encoding='utf8', errors='replace').read()
        errors = [l for l in out.splitlines() if 'error' in l.lower()]
        if errors:
            print('\nServer log (errors):\n' + '\n'.join(errors[:30]))


if __name__ == '__main__':
    main()

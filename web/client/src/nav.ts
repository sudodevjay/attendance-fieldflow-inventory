/**
 * Sidebar = the web HR screens (HRMS: dashboard, roster, payroll setup, notifications, users, audit log) and everything the
 * Windows program has in its header (toolbar + menu bar: Data, Attendance, Search/Print, Maintenance/Options, Device
 * management, Help) plus its left panel groups (Machine, Employee Schedule).
 * An item either opens a screen (`to`) or runs an action (`action`, handled in Layout). `area` = the permission area the
 * user's role must be able to open (utils/permissions on the server); items without one are always shown.
 */
export type Action =
  | 'addDevice' | 'editDevice' | 'deleteDevice' | 'connect' | 'disconnect' | 'downloadLogs' | 'downloadUsers' | 'uploadUsers'
  | 'syncTime' | 'deviceInfo' | 'clearLogs' | 'restart' | 'import' | 'backup' | 'admin' | 'attendanceRule' | 'salaryRule'
  | 'manualPunch' | 'exit' | 'help' | 'about' | 'noPhoto' | 'noAccess';

/** Runs a sidebar action from any screen. */
export const runAction = (a: Action) => window.dispatchEvent(new CustomEvent('zk:action', { detail: a }));

export interface NavItem { label: string; icon: string; color: string; to?: string; action?: Action; area?: string }
export interface NavGroup { title: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    title: 'HRMS',
    items: [
      { label: 'Dashboard', icon: 'home', color: '#16a34a', to: '/' },
      { label: 'Employee Requests / Approvals', icon: 'check', color: '#16a34a', to: '/portal-admin' },
      { label: 'Shift Roster (rotating shifts)', icon: 'calendar', color: '#a52a2a', to: '/roster' },
      { label: 'Payroll Setup (structure, PF / ESI)', icon: 'rule', color: '#2e8b57', to: '/payroll', area: 'payroll' },
      { label: 'Notifications / Announcements', icon: 'info', color: '#ea580c', to: '/notifications' },
      { label: 'Users & Roles', icon: 'lock', color: '#b8860b', to: '/users', area: 'users' },
      { label: 'Audit Log', icon: 'search', color: '#696969', to: '/audit', area: 'audit' },
    ],
  },
  {
    title: 'Toolbar',
    items: [
      { label: 'Machine List', icon: 'device', color: '#334155', to: '/machines' },
      { label: 'Employees', icon: 'people', color: '#d2691e', to: '/employees' },
      { label: 'AC Log', icon: 'clock', color: '#2563eb', to: '/aclog' },
      { label: 'Report', icon: 'report', color: '#4682b4', to: '/reports' },
      { label: 'Device (Add Device)', icon: 'device', color: '#28405a', action: 'addDevice' },
      { label: 'Del Device', icon: 'close', color: '#1e64d2', action: 'deleteDevice' },
      { label: 'Connect', icon: 'play', color: '#16a34a', action: 'connect' },
      { label: 'Disconnect', icon: 'stop', color: '#dc2626', action: 'disconnect' },
      { label: 'Exit system', icon: 'power', color: '#2563eb', action: 'exit' },
    ],
  },
  {
    title: 'Data',
    items: [
      { label: 'Import Attendance Checking Data', icon: 'import', color: '#16a34a', action: 'import' },
      { label: 'Export Attendance Checking Data', icon: 'export', color: '#ea580c', to: '/aclog' },
      { label: 'Backup Database', icon: 'backup', color: '#4682b4', action: 'backup' },
      { label: 'Usb Disk Manage', icon: 'usb', color: '#111827', action: 'import' },
      { label: 'Exit', icon: 'power', color: '#4169e1', action: 'exit' },
    ],
  },
  {
    title: 'Attendance',
    items: [
      { label: 'Leave / Holidays', icon: 'flag', color: '#7e22ce', to: '/leave' },
      { label: 'Append Manual Record (AC Log)', icon: 'clock', color: '#2563eb', action: 'manualPunch' },
      { label: 'Employee Requests (Portal)', icon: 'check', color: '#16a34a', to: '/portal-admin' },
      { label: 'Attendance Rule', icon: 'rule', color: '#4682b4', action: 'attendanceRule' },
      { label: 'Salary Rule', icon: 'rule', color: '#2e8b57', action: 'salaryRule' },
    ],
  },
  {
    title: 'Search/Print',
    items: [
      { label: 'Attendance Records (AC Log)', icon: 'search', color: '#2563eb', to: '/aclog' },
      { label: 'Attendance Reports', icon: 'report', color: '#2563eb', to: '/reports' },
    ],
  },
  {
    title: 'Maintenance/Options',
    items: [
      { label: 'Department List', icon: 'home', color: '#2e8b57', to: '/departments' },
      { label: 'Administrator', icon: 'lock', color: '#b8860b', action: 'admin' },
      { label: 'Employees', icon: 'people', color: '#d2691e', to: '/employees' },
      { label: 'Maintenance Timetables', icon: 'timer', color: '#a52a2a', to: '/shifts' },
      { label: 'Holidays / Leave Class', icon: 'sun', color: '#ea580c', to: '/leave' },
      { label: 'Attendance Rule', icon: 'rule', color: '#4682b4', action: 'attendanceRule' },
      { label: 'Salary Rule', icon: 'rule', color: '#2e8b57', action: 'salaryRule' },
      { label: 'Payroll Setup', icon: 'rule', color: '#2e8b57', to: '/payroll', area: 'payroll' },
      { label: 'Employee Portal Logins', icon: 'lock', color: '#1d4ed8', to: '/portal-admin?tab=accounts' },
      { label: 'Users & Roles', icon: 'lock', color: '#b8860b', to: '/users', area: 'users' },
      { label: 'Database Option...', icon: 'settings', color: '#696969', to: '/settings' },
    ],
  },
  {
    title: 'Device management',
    items: [
      { label: 'Add Device', icon: 'add', color: '#2563eb', action: 'addDevice' },
      { label: 'Edit Device', icon: 'edit', color: '#2563eb', action: 'editDevice' },
      { label: 'Delete Device', icon: 'close', color: '#2563eb', action: 'deleteDevice' },
      { label: 'Connect', icon: 'play', color: '#16a34a', action: 'connect' },
      { label: 'Disconnect', icon: 'stop', color: '#dc2626', action: 'disconnect' },
      { label: 'Download attendance logs', icon: 'download', color: '#16a34a', action: 'downloadLogs' },
      { label: 'Download user info and Fp', icon: 'download', color: '#2563eb', action: 'downloadUsers' },
      { label: 'Upload user info and FP', icon: 'upload', color: '#ea580c', action: 'uploadUsers' },
      { label: 'Synchronize Time', icon: 'sync', color: '#2563eb', action: 'syncTime' },
      { label: 'Device Information', icon: 'info', color: '#2563eb', action: 'deviceInfo' },
      { label: 'Clear Attendance Logs', icon: 'trash', color: '#dc2626', action: 'clearLogs' },
      { label: 'Restart Device', icon: 'refresh', color: '#696969', action: 'restart' },
    ],
  },
  {
    title: 'Machine',
    items: [
      { label: 'Download attendance logs', icon: 'download', color: '#16a34a', action: 'downloadLogs' },
      { label: 'Download user info and Fp', icon: 'download', color: '#2563eb', action: 'downloadUsers' },
      { label: 'Upload user info and FP', icon: 'upload', color: '#ea580c', action: 'uploadUsers' },
      { label: 'Attendance Photo Management', icon: 'photo', color: '#696969', action: 'noPhoto' },
      { label: 'AC Manage', icon: 'door', color: '#2e8b57', action: 'noAccess' },
    ],
  },
  {
    title: 'Employee Schedule',
    items: [
      { label: 'Maintenance Timetables', icon: 'timer', color: '#a52a2a', to: '/shifts' },
      { label: 'Shifts Management', icon: 'calendar', color: '#a52a2a', to: '/shifts' },
      { label: 'Employee Schedule', icon: 'table', color: '#a52a2a', to: '/schedule' },
      { label: 'Shift Roster (rotating)', icon: 'calendar', color: '#a52a2a', to: '/roster' },
      { label: 'Attendance Rule', icon: 'rule', color: '#2563eb', action: 'attendanceRule' },
      { label: 'Salary Rule', icon: 'rule', color: '#2e8b57', action: 'salaryRule' },
      { label: 'Leave / Holidays', icon: 'flag', color: '#7e22ce', to: '/leave' },
    ],
  },
  {
    title: 'Help',
    items: [
      { label: 'Help (README)', icon: 'help', color: '#2563eb', action: 'help' },
      { label: 'About', icon: 'info', color: '#2563eb', action: 'about' },
    ],
  },
];

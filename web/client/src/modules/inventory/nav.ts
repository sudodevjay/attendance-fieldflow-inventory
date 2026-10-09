import type { NavGroup } from '../../nav';

/** Sidebar group of the inventory (shown to roles that may open the inventory area). */
export const INVENTORY_NAV: NavGroup = {
  title: 'Inventory',
  area: 'inventory',
  items: [
    { label: 'Inventory Dashboard', icon: 'home', color: '#16a34a', to: '/inventory' },
    { label: 'Items & Stock', icon: 'table', color: '#2563eb', to: '/inventory/items' },
    { label: 'Requisitions (material requests)', icon: 'check', color: '#16a34a', to: '/inventory/requisitions' },
    { label: 'Issue / Return', icon: 'upload', color: '#ea580c', to: '/inventory/issues' },
    { label: 'Scan Station (QR / RFID)', icon: 'scan', color: '#0f766e', to: '/inventory/scan' },
    { label: 'Employee Bins', icon: 'box', color: '#9333ea', to: '/inventory/bins' },
    { label: 'Units & Tags', icon: 'tag', color: '#be185d', to: '/inventory/units' },
    { label: 'Locations (racks)', icon: 'table', color: '#0369a1', to: '/inventory/locations' },
    { label: 'Purchase Orders / Goods Receipt', icon: 'download', color: '#7e22ce', to: '/inventory/purchase' },
    { label: 'Transfer / Adjust / Stock Count', icon: 'sync', color: '#0891b2', to: '/inventory/stock' },
    { label: 'Suppliers, Stores, Categories', icon: 'folder', color: '#b8860b', to: '/inventory/masters' },
    { label: 'Inventory Reports', icon: 'report', color: '#4682b4', to: '/inventory/reports' },
    { label: 'Automation Settings', icon: 'settings', color: '#696969', to: '/inventory/masters?tab=settings' },
  ],
};

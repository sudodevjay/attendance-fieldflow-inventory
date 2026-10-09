/**
 * /api/inventory (administrator program) and /api/portal/store (employees: material requests, their bin). The attendance
 * server checks the login and the role and writes the audit log before it forwards a request here (gateway.ts).
 */
import { Router } from 'express';
import multer from 'multer';
import { fromGateway } from '../gateway';
import * as c from './controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const inventoryRoutes = Router();
const r = inventoryRoutes;
r.use(fromGateway('admin'));
r.get('/me', c.me);
r.get('/backup', c.backup);
r.get('/lookups', c.lookups);
r.get('/dashboard', c.dashboard);
r.get('/alerts', c.alerts);
r.post('/alerts/read', c.markAlerts);
r.get('/settings', c.settings);
r.put('/settings', c.saveSettings);
r.post('/automation/run', c.runChecks);

r.get('/categories', c.categories);
r.post('/categories', c.saveCategory);
r.put('/categories/:id', c.saveCategory);
r.delete('/categories/:id', c.removeCategory);
r.get('/warehouses', c.warehouses);
r.post('/warehouses', c.saveWarehouse);
r.put('/warehouses/:id', c.saveWarehouse);
r.delete('/warehouses/:id', c.removeWarehouse);
r.get('/suppliers', c.suppliers);
r.post('/suppliers', c.saveSupplier);
r.put('/suppliers/:id', c.saveSupplier);
r.delete('/suppliers/:id', c.removeSupplier);

r.get('/items', c.items);
r.get('/items/template', c.importTemplate);
r.post('/items/import', upload.single('file'), c.importItems);
r.get('/items/:id', c.item);
r.post('/items', c.saveItem);
r.put('/items/:id', c.saveItem);
r.delete('/items/:id', c.removeItem);

r.get('/stock/ledger', c.ledger);
r.get('/stock/documents', c.stockDocs);
r.post('/stock/transfer', c.transfer);
r.post('/stock/adjust', c.adjust);
r.post('/stock/count', c.count);

r.get('/requisitions', c.requisitions);
r.post('/requisitions', c.createRequisition);
r.get('/requisitions/:id', c.requisition);
r.post('/requisitions/:id/decide', c.decide);
r.post('/requisitions/:id/cancel', c.cancelRequisition);
r.post('/requisitions/:id/issue', c.issueRequisition);

r.get('/issues', c.issueList);
r.post('/issues', c.issue);
r.post('/issues/:id/return', c.returnItems);
r.post('/issues/:id/consume', c.consume);
r.get('/sites/stock', c.siteStock);
r.get('/sites/register', c.siteRegister);
r.get('/holdings', c.holdings);

r.get('/bins', c.binList);
r.get('/bins/:id', c.bin);
r.put('/bins/:id', c.saveBin);
r.get('/units', c.unitList);
r.post('/units/tag-next', c.tagNext);
r.get('/units/:id', c.unit);
r.put('/units/:id', c.saveUnit);
r.get('/scan', c.scan);
r.get('/locations', c.locationList);
r.get('/locations/where', c.whereIs);
r.get('/locations/put-away', c.toPutAway);
r.post('/locations/rack', c.createRack);
r.post('/locations/move', c.moveStock);
r.get('/locations/:id', c.location);
r.put('/locations/:id', c.saveLocation);
r.delete('/locations/:id', c.removeLocation);
r.post('/scan/return', c.scanReturn);

r.get('/purchase-orders', c.poList);
r.post('/purchase-orders', c.savePo);
r.post('/purchase-orders/reorder', c.reorderNow);
r.get('/purchase-orders/:id', c.po);
r.put('/purchase-orders/:id', c.savePo);
r.delete('/purchase-orders/:id', c.removePo);
r.post('/purchase-orders/:id/status', c.poStatus);
r.post('/purchase-orders/:id/receive', c.receive);
r.get('/receipts', c.receipts);
r.post('/receipts', c.directReceipt);

r.get('/reports', c.reportList);
r.get('/reports/:key', c.report);
r.get('/reports/:key/file', c.reportFile);

export const inventoryPortalRoutes = Router();
const p = inventoryPortalRoutes;
p.use(fromGateway('employee'));
p.get('/catalog', c.portalCatalog);
p.get('/requisitions', c.portalRequisitions);
p.post('/requisitions', c.portalCreate);
p.post('/requisitions/:id/cancel', c.portalCancel);
p.get('/holdings', c.portalHoldings);
p.get('/site-material', c.portalSiteMaterial);
p.get('/bin', c.portalBin);
p.post('/issues/:id/consume', c.portalConsume);

/**
 * The inventory API. Reached only through the attendance server, which forwards /api/inventory/* (administrator
 * program) and /api/portal/store/* (employees) with the caller's identity (see gateway.ts).
 */
import express from 'express';
import { inventoryPortalRoutes, inventoryRoutes } from './inventory/routes';
import { UserError } from './utils/errors';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/inventory', inventoryRoutes);
app.use('/api/portal/store', inventoryPortalRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof UserError) return void res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.too.large') return void res.status(413).json({ error: 'The data is too large.' });
  console.error(err);
  res.status(500).json({ error: err?.message ?? String(err) });
});

/** The Express app: JSON API under /api and the React app (web/client/dist). */
import fs from 'fs';
import path from 'path';
import express from 'express';
import { ROOT } from './config';
import { errorHandler } from './middlewares/error.middleware';
import { api } from './routes';

export const app = express();
app.disable('x-powered-by');
// Behind the Render proxy: req.ip is the caller's address (X-Forwarded-For), not the proxy's.
if (process.env.RENDER || process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use('/api', api);

const dist = path.resolve(ROOT, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use(errorHandler);

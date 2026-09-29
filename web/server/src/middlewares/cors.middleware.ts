import type { NextFunction, Request, Response } from 'express';

/** The mobile app (and its web preview) calls the portal API from another origin; it sends a bearer token, no cookies. */
export function portalCors(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return void res.sendStatus(204);
  next();
}

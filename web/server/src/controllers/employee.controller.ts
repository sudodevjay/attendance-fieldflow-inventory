import type { Request, Response } from 'express';
import * as deviceUsers from '../services/deviceUser.service';
import * as employees from '../services/employee.service';
import * as excel from '../services/employeeExcel.service';
import { UserError } from '../utils/errors';
import { bodyIds, idParam, numQuery, sendFile } from '../utils/http';

export const list = async (req: Request, res: Response) =>
  res.json(await employees.list(numQuery(req.query.dept), req.query.includeSub !== '0', String(req.query.q ?? '')));

export const options = async (req: Request, res: Response) => res.json(await employees.options(req.query.active === '1'));
export const nextNo = async (_req: Request, res: Response) => res.json({ next: await employees.nextEnrollNo() });
export const detail = async (req: Request, res: Response) => res.json(await employees.detail(idParam(req)));
export const create = async (req: Request, res: Response) => res.json({ id: await employees.save(null, req.body) });
export const update = async (req: Request, res: Response) => res.json({ id: await employees.save(idParam(req), req.body) });

export async function removeMany(req: Request, res: Response) {
  await employees.removeMany(bodyIds(req));
  res.json({ ok: true });
}

export const deleteFinger = async (req: Request, res: Response) =>
  res.json({ message: await employees.deleteFinger(idParam(req), idParam(req, 'index')) });

export const photos = async (req: Request, res: Response) =>
  res.json(await employees.photos((Array.isArray(req.body.enrollNos) ? req.body.enrollNos : []).map(String)));

export async function exportExcel(req: Request, res: Response) {
  const f = await excel.exportEmployees(bodyIds(req));
  sendFile(res, f.buffer, f.name);
}

export async function importExcel(req: Request, res: Response) {
  if (!req.file) throw new UserError('Choose an Excel file.');
  res.json({ message: await excel.importEmployees(req.file.buffer) });
}

export const uploadToDevice = async (req: Request, res: Response) =>
  res.json({ message: await deviceUsers.upload(bodyIds(req), numQuery(req.body.deviceId), req.user ?? '') });

export const deleteFromDevice = async (req: Request, res: Response) =>
  res.json({ message: await deviceUsers.removeFromDevice(bodyIds(req), numQuery(req.body.deviceId), req.user ?? '') });

export const downloadFromDevice = async (req: Request, res: Response) =>
  res.json({ message: await deviceUsers.download(numQuery(req.body.deviceId), !!req.body.overwrite) });

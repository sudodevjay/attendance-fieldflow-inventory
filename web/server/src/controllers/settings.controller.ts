import type { Request, Response } from 'express';
import { changePassword } from '../services/auth.service';
import { newPiToken } from '../services/pi.service';
import * as settings from '../services/settings.service';
import * as system from '../services/system.service';

export const company = async (_req: Request, res: Response) =>
  res.json({ ...(await settings.companySettings()), connectionString: system.maskedConnectionString() });

export async function saveCompany(req: Request, res: Response) {
  await settings.saveCompany(req.body);
  res.json({ message: 'Settings saved.' });
}

export async function saveAdms(req: Request, res: Response) {
  await settings.saveAdms(!!req.body.enabled, Number(req.body.port));
  res.json({ message: 'Saved. The ADMS server runs in the Windows program: it applies the change when it is restarted.' });
}

export const testConnection = async (req: Request, res: Response) =>
  res.json({ message: await system.testConnection(String(req.body.connectionString ?? '')) });

export const saveConnection = (req: Request, res: Response) =>
  res.json({ message: system.saveConnection(String(req.body.connectionString ?? '')) });

export async function backup(_req: Request, res: Response) {
  const { name, data } = await system.backup();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(data);
}

export const attendanceRule = async (_req: Request, res: Response) => res.json(await settings.loadAttendanceRules());

export async function saveAttendanceRule(req: Request, res: Response) {
  await settings.saveAttendanceRules(req.body);
  res.json({ message: 'Attendance rule saved.' });
}

export const salaryRule = async (_req: Request, res: Response) => res.json(await settings.loadPayrollRules());

export async function saveSalaryRule(req: Request, res: Response) {
  await settings.savePayrollRules(req.body);
  res.json({ message: 'Salary rule saved.' });
}

export const adminPassword = async (req: Request, res: Response) =>
  res.json({ message: await changePassword(String(req.body.current ?? ''), String(req.body.password ?? ''), String(req.body.confirm ?? '')) });

export const pi = async (_req: Request, res: Response) => res.json(await system.piSetup());

export const newToken = async (_req: Request, res: Response) =>
  res.json({ token: await newPiToken(), message: 'New token created. Put it in /etc/lx50pi/config.ini on the Pi (token =) and restart the Pi service.' });

export const readme = (_req: Request, res: Response) => res.json({ text: system.readme() });

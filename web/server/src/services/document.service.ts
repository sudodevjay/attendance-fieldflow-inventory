/** Employee documents (EmployeeDocuments, web only): ID proofs, offer letter, certificates … stored as base64. */
import { exec, one, query } from '../config/db';
import { UserError } from '../utils/errors';
import { assertInScope } from '../utils/scope';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
/** Allowed extensions and the content type they are served with (never the type the browser sent). */
const TYPES: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain; charset=utf-8',
};
const typeOf = (name: string) => TYPES[/\.([^.]+)$/.exec(name)?.[1].toLowerCase() ?? ''];

export async function list(employeeId: number) {
  assertInScope(employeeId);
  const rows = await query(`SELECT Id, Title, FileName, ContentType, SizeBytes, UploadedBy, to_char(UploadedAt, 'YYYY-MM-DD HH24:MI') AS UploadedAt
    FROM EmployeeDocuments WHERE EmployeeId = @id ORDER BY UploadedAt DESC`, { id: employeeId });
  return rows;
}

export async function add(employeeId: number, title: string, file: { originalname: string; buffer: Buffer }, by: string) {
  if (!(await one('SELECT Id FROM Employees WHERE Id = @id', { id: employeeId }))) throw new UserError('Employee not found.', 404);
  if (!file?.buffer?.length) throw new UserError('Choose a file.');
  if (file.buffer.length > MAX_DOCUMENT_BYTES) throw new UserError('The file is larger than 5 MB.');
  const name = file.originalname.replace(/[\/:*?"<>|]/g, '_').slice(0, 200);
  if (!typeOf(name)) throw new UserError('Allowed files: PDF, JPG, PNG, GIF, WEBP, Word, Excel, TXT.');
  const t = title.trim().slice(0, 100) || name.replace(/\.[^.]+$/, '');
  const r = await one(`INSERT INTO EmployeeDocuments (EmployeeId, Title, FileName, ContentType, SizeBytes, Data, UploadedBy)
    VALUES (@e, @t, @f, @c, @s, @d, @by) RETURNING Id`,
  { e: employeeId, t, f: name, c: typeOf(name), s: file.buffer.length,
    d: file.buffer.toString('base64'), by: by.slice(0, 100) });
  return r!.Id as number;
}

/** The file (owner check by the caller). */
export async function get(id: number) {
  const r = await one('SELECT EmployeeId, FileName, ContentType, Data FROM EmployeeDocuments WHERE Id = @id', { id });
  if (!r) throw new UserError('Document not found.', 404);
  assertInScope(r.EmployeeId);
  return { employeeId: r.EmployeeId as number, name: r.FileName as string, type: typeOf(r.FileName) ?? 'application/octet-stream', buffer: Buffer.from(r.Data, 'base64') };
}

/** Deletes a document; `employeeId` limits it to that employee's own uploads (portal). */
export async function remove(id: number, employeeId?: number) {
  const n = employeeId === undefined
    ? await exec('DELETE FROM EmployeeDocuments WHERE Id = @id', { id })
    : await exec("DELETE FROM EmployeeDocuments WHERE Id = @id AND EmployeeId = @e AND UploadedBy LIKE 'Employee%'", { id, e: employeeId });
  if (!n) throw new UserError(employeeId === undefined ? 'Document not found.' : 'Only documents you uploaded yourself can be deleted.');
}

/** One-line text of an employee request (EmployeeRequests row from the server) for lists. */
import { inr } from './api';
import { FIELD_LABELS } from './profileFields';

export function requestTitle(r: any): string {
  switch (r.Type) {
    case 'Regularisation': return `${r.Category} ${r.Time}`;
    case 'Overtime': return `Overtime · ${r.Amount} h`;
    case 'CompOff': return `Comp-off · ${r.Amount} day`;
    case 'Profile': return 'Profile change';
    default: return `${r.Category} · ${inr(r.Amount)}`;
  }
}

/** Profile change: "Mobile: 98…, IFSC: SBIN…"; other types: the details. */
export function requestDetails(r: any): string {
  if (r.Type === 'Profile' && r.Changes)
    return Object.entries(r.Changes as Record<string, string>).map(([k, v]) => `${FIELD_LABELS[k] ?? k}: ${v || '(empty)'}`).join(', ');
  return r.Details ?? '';
}

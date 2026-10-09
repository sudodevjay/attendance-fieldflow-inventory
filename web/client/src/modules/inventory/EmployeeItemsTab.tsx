/**
 * Employee List → Store Items: the employee's bin (Inventory → Employee Bins): what the store gave them, what they still
 * hold, what is at a site, installed or given back, and the bin limit. Shown to the roles that may open the inventory.
 */
import { Note } from '../../ui';
import { BinView } from './pages/Bins';

export function EmployeeItemsTab({ employeeId }: { employeeId: number }) {
  if (!employeeId) return <Note>Save the employee first.</Note>;
  return <BinView employeeId={employeeId} allowEdit={false} />;
}

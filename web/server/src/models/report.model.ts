/** A report as grid / Excel / PDF show it: title, columns and rows of text. */
export interface ReportResult {
  title: string;
  subtitle: string;
  columns: string[];
  rows: (string | number)[][];
  /** Columns whose values are attendance status codes (colored in grid / Excel / PDF). */
  statusColumns: string[];
}

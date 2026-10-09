/** Number formats shared by reports, payroll and exports. */

/** .NET Num(): "3" or "2.5". */
export const num = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1));

/** .NET Math.Round(x, 2) on decimals rounds half to even. */
export function round2(v: number): number {
  const x = v * 100;
  const r = Math.round(x);
  const isHalf = Math.abs(Math.abs(x % 1) - 0.5) < 1e-9;
  return (isHalf && r % 2 !== 0 ? r - Math.sign(x) : r) / 100;
}

const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (v: number) => INR.format(v);

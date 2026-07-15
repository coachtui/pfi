import type { DailySnapshot, ISODate } from "./types";

export type ReportGranularity = "monthly" | "quarterly";

export interface ReportPeriod {
  key: string;
  label: string;
  start: ISODate;
  end: ISODate;
  complete: boolean;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ymd(date: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function iso(y: number, m1: number, d: number): ISODate {
  return `${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Last calendar day of month m1 (1-based) in year y. */
function lastDayOfMonth(y: number, m1: number): number {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}

export function enumeratePeriods(
  snapshots: DailySnapshot[],
  granularity: ReportGranularity,
): ReportPeriod[] {
  if (snapshots.length === 0) return [];
  const first = snapshots[0].date;
  const last = snapshots[snapshots.length - 1].date;
  const { y: fy, m: fm } = ymd(first);
  const { y: ly, m: lm } = ymd(last);
  const periods: ReportPeriod[] = [];

  if (granularity === "monthly") {
    let y = fy;
    let m = fm;
    while (y < ly || (y === ly && m <= lm)) {
      const start = iso(y, m, 1);
      const end = iso(y, m, lastDayOfMonth(y, m));
      periods.push({
        key: `${y}-M${String(m).padStart(2, "0")}`,
        label: `${MONTHS[m - 1]} ${y}`,
        start,
        end,
        complete: start >= first && end <= last,
      });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  } else {
    const lastQ = Math.floor((lm - 1) / 3);
    let y = fy;
    let q = Math.floor((fm - 1) / 3);
    while (y < ly || (y === ly && q <= lastQ)) {
      const startM = q * 3 + 1;
      const endM = q * 3 + 3;
      const start = iso(y, startM, 1);
      const end = iso(y, endM, lastDayOfMonth(y, endM));
      periods.push({
        key: `${y}-Q${q + 1}`,
        label: `Q${q + 1} ${y}`,
        start,
        end,
        complete: start >= first && end <= last,
      });
      q += 1;
      if (q > 3) { q = 0; y += 1; }
    }
  }
  return periods;
}

export function latestCompletePeriod(periods: ReportPeriod[]): ReportPeriod | null {
  for (let i = periods.length - 1; i >= 0; i--) {
    if (periods[i].complete) return periods[i];
  }
  return periods[periods.length - 1] ?? null;
}

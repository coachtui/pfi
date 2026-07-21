export function toCents(amount: number | null): number | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

export function centsToMoney(cents: number): number {
  return cents / 100;
}

export function addMoney(values: Array<number | null>): number | null {
  let total = 0;
  for (const v of values) {
    const cents = toCents(v);
    if (cents === null) return null;
    total += cents;
  }
  return centsToMoney(total);
}

export function differenceMoney(left: number, right: number): number {
  return centsToMoney(toCents(left)! - toCents(right)!);
}

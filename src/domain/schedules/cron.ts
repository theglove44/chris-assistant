export function matchesCron(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ];

  for (let i = 0; i < 5; i++) {
    if (!fieldMatches(fields[i], values[i], i === 4)) return false;
  }

  return true;
}

function fieldMatches(field: string, value: number, isDow: boolean): boolean {
  if (field.includes(",")) {
    return field.split(",").some((part) => fieldMatches(part.trim(), value, isDow));
  }

  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) return false;
    return value % step === 0;
  }

  if (field === "*") return true;

  if (field.includes("-")) {
    const [lo, hi] = field.split("-").map((p) => parseInt(p.trim(), 10));
    if (isNaN(lo) || isNaN(hi)) return false;
    return value >= lo && value <= hi;
  }

  const num = parseInt(field, 10);
  if (isNaN(num)) return false;

  if (isDow && num === 7) return value === 0;

  return value === num;
}

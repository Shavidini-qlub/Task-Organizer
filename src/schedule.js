// Date math for repeating tasks. Dates are calendar days as "YYYY-MM-DD"
// strings, handled in UTC so the server's timezone never shifts them.

export const REPEATS = ["daily", "weekdays", "weekly", "monthly"];

function parse(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmt(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

export function daysBetween(a, b) {
  return Math.round((parse(b) - parse(a)) / 86400000);
}

// The occurrence after `day`. Monthly keeps the day of the month, clamped to
// the month's last day (Jan 31 → Feb 28).
export function nextOccurrence(day, repeat) {
  if (repeat === "daily") return addDays(day, 1);
  if (repeat === "weekly") return addDays(day, 7);
  if (repeat === "weekdays") {
    let next = addDays(day, 1);
    while ([0, 6].includes(parse(next).getUTCDay())) next = addDays(next, 1);
    return next;
  }
  if (repeat === "monthly") {
    const d = parse(day);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return fmt(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay))));
  }
  throw new Error("unknown repeat: " + repeat);
}

// When a repeating task scheduled for `scheduledDay` is completed on
// `doneDay`, the next copy lands on the first occurrence after `doneDay`, so
// finishing a weekly task late doesn't leave a backlog of missed copies.
export function nextAfter(scheduledDay, repeat, doneDay) {
  let next = nextOccurrence(scheduledDay, repeat);
  while (next <= doneDay) next = nextOccurrence(next, repeat);
  return next;
}

// Weeks run Monday to Sunday and are named by their Monday (YYYY-MM-DD).

export function mondayOf(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

// Today's date in Ireland, as YYYY-MM-DD (the server runs on UTC).
export function dublinToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(now);
}

// The week that holds today's date in Ireland.
export function defaultWeek(now = new Date()) {
  return mondayOf(new Date(`${dublinToday(now)}T00:00:00Z`));
}

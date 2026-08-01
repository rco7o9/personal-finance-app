// Date range presets for the expenses dashboard.
//
// All "today" math is anchored to IST explicitly (Intl.DateTimeFormat with
// timeZone: "Asia/Kolkata") rather than the server process's system timezone —
// this app runs in Docker where the container may default to UTC, and reading
// the date near midnight IST with a naive `new Date()` + UTC getters would
// silently roll to the wrong calendar day. Once we have year/month/day as plain
// numbers, all further arithmetic uses the LOCAL Date constructor and LOCAL
// getters only (never toISOString()/getUTCX()) so it stays timezone-safe.

export type RangePreset = "month" | "3m" | "6m" | "year";

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "month", label: "This Month" },
  { value: "3m", label: "Last 3 Months" },
  { value: "6m", label: "Last 6 Months" },
  { value: "year", label: "Full Year" },
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function todayIST(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function lastDayOfMonth(year: number, month: number): number {
  // month is 1-indexed; new Date(year, month, 0) lands on the day before the
  // 1st of `month` in the LOCAL Date constructor's 0-indexed scheme — i.e. the
  // last day of the 1-indexed month we asked for.
  return new Date(year, month, 0).getDate();
}

export function computeDateRange(preset: string): {
  startDate: string;
  endDate: string;
  label: string;
} {
  const { year, month } = todayIST();
  const found = RANGE_PRESETS.find((p) => p.value === preset) ?? RANGE_PRESETS[0];

  if (found.value === "year") {
    return { startDate: ymd(year, 1, 1), endDate: ymd(year, 12, 31), label: found.label };
  }

  const monthsBack = found.value === "month" ? 0 : found.value === "3m" ? 2 : 5;
  // The local Date constructor normalizes negative/overflowing month values
  // (e.g. month index -4 correctly resolves to September of the prior year).
  const start = new Date(year, month - 1 - monthsBack, 1);

  return {
    startDate: ymd(start.getFullYear(), start.getMonth() + 1, 1),
    endDate: ymd(year, month, lastDayOfMonth(year, month)),
    label: found.label,
  };
}

// ── Calendar picker helpers ──────────────────────────────────────────────────
// These support the free-form calendar (single day / whole month / arbitrary
// range) in DateRangeSelector. They run entirely client-side in the browser,
// which — unlike the Docker-hosted server — already runs in the user's real
// local timezone, so plain local Date getters (never toISOString()/getUTCX())
// are timezone-safe here without needing the explicit IST anchor above.

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_ABBR = MONTH_NAMES.map((m) => m.slice(0, 3));

export function todayLocal(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Converts a plain local Date to a YYYY-MM-DD string using local getters —
// never toISOString(), which shifts to UTC and can roll back a calendar day.
export function dateToYmd(date: Date): string {
  return ymd(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

// Parses a YYYY-MM-DD string into a local Date at local midnight. Deliberately
// NOT `new Date(str)` — that parses as UTC midnight, which can display as the
// previous day once rendered in a timezone ahead of UTC (see memory:
// feedback_date_string_parsing).
export function parseYmd(value: string): Date {
  const [y, m, d] = value.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonthDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function monthLabel(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

// Human label for an arbitrary committed [startDate, endDate] pair, used as the
// selector's trigger text. Recognizes the common shapes (single day, whole
// month, whole year) and falls back to a plain "start – end" range otherwise.
export function describeDateRange(startDate: string, endDate: string): string {
  const start = parseYmd(startDate);
  const end = parseYmd(endDate);

  const fmt = (d: Date, withYear: boolean) =>
    withYear
      ? `${d.getDate()} ${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`
      : `${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`;

  if (isSameDay(start, end)) {
    return fmt(start, true);
  }

  const isWholeMonth =
    start.getDate() === 1 &&
    isSameDay(end, endOfMonthDate(start)) &&
    start.getMonth() === end.getMonth() &&
    start.getFullYear() === end.getFullYear();
  if (isWholeMonth) {
    return monthLabel(start);
  }

  const isWholeYear =
    start.getMonth() === 0 &&
    start.getDate() === 1 &&
    end.getMonth() === 11 &&
    end.getDate() === 31 &&
    start.getFullYear() === end.getFullYear();
  if (isWholeYear) {
    return `${start.getFullYear()}`;
  }

  const sameYear = start.getFullYear() === end.getFullYear();
  return `${fmt(start, !sameYear)} – ${fmt(end, true)}`;
}

export function isValidYmd(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

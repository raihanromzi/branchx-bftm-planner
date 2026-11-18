// Shared Indonesian formats for numbers, dates and times (DESIGN.md, E0-S4). Every date and time is shown
// in WIB (Asia/Jakarta), whatever the device's time zone. Nouns next to a number take no plural suffix:
// "1 rekening", "1.250 rekening".

const LOCALE = "id-ID";
const TIME_ZONE = "Asia/Jakarta";

const numberFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const monthFormat = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, month: "long", year: "numeric" });

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Not a valid date: ${String(value)}`);
  return date;
}

/** 1250 → "1.250". */
export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** → "18 Nov 2026", the calendar day in WIB. */
export function formatDate(value: DateInput): string {
  return dateFormat.format(toDate(value));
}

/** → "14.30 WIB". */
export function formatTime(value: DateInput): string {
  // id-ID already separates hours and minutes with "."; normalise in case an ICU build uses ":".
  return `${timeFormat.format(toDate(value)).replace(":", ".")} WIB`;
}

/** → "18 Nov 2026, 14.30 WIB". */
export function formatDateTime(value: DateInput): string {
  return `${formatDate(value)}, ${formatTime(value)}`;
}

/** → "November 2026". */
export function formatMonth(value: DateInput): string {
  return monthFormat.format(toDate(value));
}

/**
 * A stored phone number ("+6281234567890") in the local format people dial: "0812-3456-7890".
 * The first four digits form one group; the rest is split in two, the longer half first
 * ("+62812345678" → "0812-345-678", "+628123456789" → "0812-3456-789"). Anything that is not a
 * stored +62 number is returned unchanged.
 */
export function formatPhone(value: string): string {
  const match = /^\+62(\d{9,13})$/.exec(value);
  if (!match) return value;
  const local = `0${match[1]}`;
  const head = local.slice(0, 4);
  const rest = local.slice(4);
  const split = Math.ceil(rest.length / 2);
  return `${head}-${rest.slice(0, split)}-${rest.slice(split)}`;
}

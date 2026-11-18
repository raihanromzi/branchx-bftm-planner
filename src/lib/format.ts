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

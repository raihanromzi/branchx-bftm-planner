// The Prospect list's state in the URL (E2-S2, EC6): `/prospect?q=&kategori=&fo=&arsip=1&hal=2`.
// Pure functions, unit-tested, shared by the screen and its tests. The URL uses Indonesian names; the
// API (GET /api/prospects, api.md) uses q, category, fundingOfficerId, archived and page.
import { PROSPECT_CATEGORIES, PROSPECT_NAME_MAX, type ProspectCategory } from "@/lib/validation";

export type ProspectListParams = {
  /** Search text as typed (trimmed when sent). Empty when there is none. */
  q: string;
  category: ProspectCategory | null;
  fundingOfficerId: string | null;
  /** "Tampilkan arsip": include archived Prospects. */
  archived: boolean;
  /** 1-based page. */
  page: number;
};

export const DEFAULT_LIST_PARAMS: ProspectListParams = {
  q: "",
  category: null,
  fundingOfficerId: null,
  archived: false,
  page: 1,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGE = 100_000;

type Readable = { get(name: string): string | null };

/**
 * Reads the list state from the URL. A value the API would refuse (an unknown Category, a Funding Officer
 * id that is not a UUID, a page that is not a whole number from 1) is ignored rather than shown as an error,
 * since anyone can edit a URL. Search longer than 150 characters is cut to 150.
 */
export function parseListParams(search: Readable): ProspectListParams {
  const q = (search.get("q") ?? "").slice(0, PROSPECT_NAME_MAX);
  const kategori = search.get("kategori");
  const fo = search.get("fo")?.trim() ?? "";
  const hal = search.get("hal") ?? "";
  const page = /^\d+$/.test(hal) ? Number(hal) : 1;
  return {
    q,
    category: PROSPECT_CATEGORIES.includes(kategori as ProspectCategory) ? (kategori as ProspectCategory) : null,
    fundingOfficerId: UUID_PATTERN.test(fo) ? fo : null,
    archived: search.get("arsip") === "1",
    page: page >= 1 && page <= MAX_PAGE ? page : 1,
  };
}

/** The screen's query string, defaults left out: "" or "?q=kramat&kategori=pasar&hal=2". */
export function toScreenSearch(params: ProspectListParams): string {
  const search = new URLSearchParams();
  if (params.q.trim()) search.set("q", params.q.trim());
  if (params.category) search.set("kategori", params.category);
  if (params.fundingOfficerId) search.set("fo", params.fundingOfficerId);
  if (params.archived) search.set("arsip", "1");
  if (params.page > 1) search.set("hal", String(params.page));
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** The GET /api/prospects query string for the same state, defaults left out. */
export function toApiSearch(params: ProspectListParams): string {
  const search = new URLSearchParams();
  if (params.q.trim()) search.set("q", params.q.trim());
  if (params.category) search.set("category", params.category);
  if (params.fundingOfficerId) search.set("fundingOfficerId", params.fundingOfficerId);
  if (params.archived) search.set("archived", "1");
  if (params.page > 1) search.set("page", String(params.page));
  const text = search.toString();
  return text ? `?${text}` : "";
}

/**
 * Whether search or a filter narrows the list, so an empty answer means "nothing matched" rather than "no
 * Prospects yet". "Tampilkan arsip" only widens the list, so it does not count.
 */
export function hasFilters(params: ProspectListParams): boolean {
  return Boolean(params.q.trim() || params.category || params.fundingOfficerId);
}

/** Number of pages for a total at the API's fixed page size. At least 1. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

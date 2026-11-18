import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIST_PARAMS,
  hasFilters,
  pageCount,
  parseListParams,
  toApiSearch,
  toScreenSearch,
} from "@/components/prospects/list-params";
import { stageBucket, stageLabel } from "@/lib/stage";

const FO_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const parse = (query: string) => parseListParams(new URLSearchParams(query));

describe("E2-S2 stageBucket: ceil(position / stageCount × 5), DESIGN.md Status display", () => {
  it("one Stage is the last bucket", () => {
    expect(stageBucket(1, 1)).toBe(5);
  });

  it("three Stages: 2, 4, 5", () => {
    expect([1, 2, 3].map((position) => stageBucket(position, 3))).toEqual([2, 4, 5]);
  });

  it("five Stages: one bucket each, 1 to 5", () => {
    expect([1, 2, 3, 4, 5].map((position) => stageBucket(position, 5))).toEqual([1, 2, 3, 4, 5]);
  });

  it("seven Stages: 1, 2, 3, 3, 4, 5, 5", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((position) => stageBucket(position, 7))).toEqual([1, 2, 3, 3, 4, 5, 5]);
  });

  it("ten Stages: two per bucket", () => {
    expect(Array.from({ length: 10 }, (_, index) => stageBucket(index + 1, 10))).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
    ]);
  });

  it("the last Stage is always bucket 5, and the first never above it", () => {
    for (let count = 1; count <= 20; count += 1) {
      expect(stageBucket(count, count)).toBe(5);
      expect(stageBucket(1, count)).toBeGreaterThanOrEqual(1);
    }
  });

  it("clamps out-of-range input into 1 to 5", () => {
    expect(stageBucket(0, 5)).toBe(1);
    expect(stageBucket(9, 5)).toBe(5);
    expect(stageBucket(1, 0)).toBe(1);
    expect(stageBucket(Number.NaN, 5)).toBe(1);
  });

  it("names the badge 'Presentasi, tahap 3 dari 5'", () => {
    expect(stageLabel("Presentasi", 3, 5)).toBe("Presentasi, tahap 3 dari 5");
  });
});

describe("E2-S2 list state in the URL (?q=&kategori=&fo=&arsip=1&hal=2)", () => {
  it("reads every parameter", () => {
    expect(parse(`q=kramat&kategori=pasar&fo=${FO_ID}&arsip=1&hal=2`)).toEqual({
      q: "kramat",
      category: "pasar",
      fundingOfficerId: FO_ID,
      archived: true,
      page: 2,
    });
  });

  it("gives the defaults for an empty query", () => {
    expect(parse("")).toEqual(DEFAULT_LIST_PARAMS);
  });

  it("ignores values the API would refuse", () => {
    expect(parse("kategori=bank&fo=123&arsip=yes&hal=0")).toEqual(DEFAULT_LIST_PARAMS);
    expect(parse("hal=-3").page).toBe(1);
    expect(parse("hal=2.5").page).toBe(1);
    expect(parse("hal=abc").page).toBe(1);
    expect(parse("hal=100001").page).toBe(1);
  });

  it("cuts a search longer than 150 characters", () => {
    expect(parse(`q=${"a".repeat(200)}`).q).toHaveLength(150);
  });

  it("writes the screen URL with defaults left out and the search trimmed", () => {
    expect(toScreenSearch(DEFAULT_LIST_PARAMS)).toBe("");
    expect(toScreenSearch({ ...DEFAULT_LIST_PARAMS, q: "  kramat jati " })).toBe("?q=kramat+jati");
    expect(
      toScreenSearch({ q: "kramat", category: "pasar", fundingOfficerId: FO_ID, archived: true, page: 2 }),
    ).toBe(`?q=kramat&kategori=pasar&fo=${FO_ID}&arsip=1&hal=2`);
  });

  it("maps the same state to the API's parameter names", () => {
    expect(toApiSearch(DEFAULT_LIST_PARAMS)).toBe("");
    expect(
      toApiSearch({ q: "kramat", category: "pasar", fundingOfficerId: FO_ID, archived: true, page: 2 }),
    ).toBe(`?q=kramat&category=pasar&fundingOfficerId=${FO_ID}&archived=1&page=2`);
  });

  it("round-trips through the URL", () => {
    const state = { q: "SDN 3 Cibinong & co", category: "sekolah" as const, fundingOfficerId: FO_ID, archived: false, page: 7 };
    expect(parse(toScreenSearch(state).slice(1))).toEqual(state);
  });

  it("counts search, Category and Funding Officer as filters, but not 'Tampilkan arsip'", () => {
    expect(hasFilters(DEFAULT_LIST_PARAMS)).toBe(false);
    expect(hasFilters({ ...DEFAULT_LIST_PARAMS, archived: true, page: 3 })).toBe(false);
    expect(hasFilters({ ...DEFAULT_LIST_PARAMS, q: "   " })).toBe(false);
    expect(hasFilters({ ...DEFAULT_LIST_PARAMS, q: "kramat" })).toBe(true);
    expect(hasFilters({ ...DEFAULT_LIST_PARAMS, category: "pasar" })).toBe(true);
    expect(hasFilters({ ...DEFAULT_LIST_PARAMS, fundingOfficerId: FO_ID })).toBe(true);
  });

  it("counts pages at 50 per page, at least one", () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
    expect(pageCount(1248, 50)).toBe(25);
  });
});

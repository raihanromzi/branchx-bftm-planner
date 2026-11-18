import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { MAIN_DESTINATIONS, SETTINGS_DESTINATIONS, isCurrent } from "@/components/shell/destinations";
import { formatDate, formatDateTime, formatMonth, formatNumber, formatTime } from "@/lib/format";

const root = join(__dirname, "..", "..");

describe("E0-S4 format helpers (criterion 5, EC44)", () => {
  it("groups thousands with a dot", () => {
    expect(formatNumber(1250)).toBe("1.250");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(1_234_567_890)).toBe("1.234.567.890");
  });

  it("renders a date as day, short month and year", () => {
    expect(formatDate(new Date("2026-11-18T07:30:00Z"))).toBe("18 Nov 2026");
    expect(formatDate("2026-05-05T03:00:00Z")).toBe("5 Mei 2026");
  });

  it("renders a time with a dot separator and WIB", () => {
    expect(formatTime(new Date("2026-11-18T07:30:00Z"))).toBe("14.30 WIB");
    expect(formatTime(new Date("2026-11-18T17:05:00Z"))).toBe("00.05 WIB");
  });

  it("uses the WIB calendar day, not UTC: late on the 31st in UTC is the 1st in WIB", () => {
    const instant = new Date("2026-12-31T20:00:00Z");
    expect(formatDate(instant)).toBe("1 Jan 2027");
    expect(formatTime(instant)).toBe("03.00 WIB");
    expect(formatMonth(instant)).toBe("Januari 2027");
    expect(formatDateTime(instant)).toBe("1 Jan 2027, 03.00 WIB");
  });

  it("combines date and time, and names the month in full", () => {
    expect(formatDateTime("2026-11-18T07:30:00Z")).toBe("18 Nov 2026, 14.30 WIB");
    expect(formatMonth("2026-11-18T07:30:00Z")).toBe("November 2026");
  });

  it("adds no plural suffix: the same noun follows 1 and 1.250", () => {
    expect(`${formatNumber(1)} rekening`).toBe("1 rekening");
    expect(`${formatNumber(1250)} rekening`).toBe("1.250 rekening");
  });

  it("rejects an invalid date instead of printing 'Invalid Date'", () => {
    expect(() => formatDate("bukan tanggal")).toThrow(RangeError);
  });
});

describe("E0-S4 web app manifest (criterion 4)", () => {
  it("has the name, start URL, standalone display, colours and the 192, 512 and maskable icons", () => {
    const m = manifest();
    expect(m).toMatchObject({
      name: "BFTM Planner",
      short_name: "BFTM Planner",
      start_url: "/",
      display: "standalone",
      theme_color: "#0E6E73",
      background_color: "#FFFFFF",
    });
    expect(m.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });

  it("ships each icon as a PNG of the stated size", () => {
    for (const icon of manifest().icons ?? []) {
      const png = readFileSync(join(root, "public", icon.src));
      expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
      const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
      expect(`${width}x${height}`).toBe(icon.sizes);
    }
  });
});

describe("E0-S4 navigation destinations (criterion 1)", () => {
  it("lists Dasbor, Prospect, Jadwal and Peta, and the three Pengaturan screens", () => {
    expect(MAIN_DESTINATIONS.map((d) => [d.label, d.href])).toEqual([
      ["Dasbor", "/"],
      ["Prospect", "/prospect"],
      ["Jadwal", "/jadwal"],
      ["Peta", "/peta"],
    ]);
    expect(SETTINGS_DESTINATIONS.map((d) => d.label)).toEqual(["Funding Officer", "Template Pipeline", "Target"]);
  });

  it("marks the dashboard current only on /, and other destinations on their own path and below it", () => {
    expect(isCurrent("/", "/")).toBe(true);
    expect(isCurrent("/prospect", "/")).toBe(false);
    expect(isCurrent("/prospect/123", "/prospect")).toBe(true);
    expect(isCurrent("/prospectus", "/prospect")).toBe(false);
  });
});

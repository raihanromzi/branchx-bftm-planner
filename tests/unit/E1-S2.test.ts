import { describe, expect, it } from "vitest";
import { sortFundingOfficers, type FundingOfficer } from "@/components/funding-officers/shared";
import { formatPhone } from "@/lib/format";
import { normalizePhone } from "@/lib/validation";

describe("E1-S2 formatPhone: a stored +62 number in local format", () => {
  it("shows a 12-digit mobile number as 0812-3456-7890", () => {
    expect(formatPhone("+6281234567890")).toBe("0812-3456-7890");
  });

  it("splits the digits after the first four in two, the longer half first", () => {
    expect(formatPhone("+62812345678")).toBe("0812-345-678"); // 9 digits after +62, the shortest allowed
    expect(formatPhone("+628123456789")).toBe("0812-3456-789");
    expect(formatPhone("+62812345678901")).toBe("0812-34567-8901");
    expect(formatPhone("+628123456789012")).toBe("0812-34567-89012"); // 13 digits, the longest allowed
  });

  it("round-trips: what it shows is accepted by the phone rule and stores the same number", () => {
    for (const stored of ["+62812345678", "+6281234567890", "+628123456789012", "+62213456789"]) {
      expect(normalizePhone(formatPhone(stored))).toBe(stored);
    }
  });

  it("returns anything that is not a stored +62 number unchanged", () => {
    expect(formatPhone("")).toBe("");
    expect(formatPhone("081234567890")).toBe("081234567890");
    expect(formatPhone("+1 555 0100")).toBe("+1 555 0100");
    expect(formatPhone("+6212345")).toBe("+6212345");
  });
});

describe("E1-S2 list order after a local change (criterion 1)", () => {
  const officer = (name: string, active: boolean, id = name): FundingOfficer => ({
    id,
    name,
    phone: "+6281234567890",
    active,
    version: 1,
    createdAt: "2026-11-19T02:15:00.000Z",
    updatedAt: "2026-11-19T02:15:00.000Z",
  });

  it("puts active Funding Officers first, then inactive ones, each by name ignoring case", () => {
    const sorted = sortFundingOfficers([
      officer("dedi Pratama", false),
      officer("Rina Kartika", true),
      officer("agus Setiawan", true),
      officer("Budi Santoso", false),
    ]);
    expect(sorted.map((item) => item.name)).toEqual(["agus Setiawan", "Rina Kartika", "Budi Santoso", "dedi Pratama"]);
  });
});

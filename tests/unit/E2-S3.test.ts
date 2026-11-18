import { describe, expect, it } from "vitest";
import {
  characterCount,
  coordinatesToLocation,
  coordinateText,
  EMPTY_FORM,
  firstErrorField,
  formatLocation,
  limitCharacters,
  parseCoordinate,
  parsePotentialAccounts,
  type ProspectRecord,
  toApiBody,
  toFieldErrors,
  validateValues,
  valuesFromRecord,
} from "@/components/prospects/form-state";

const FO_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const filled = { ...EMPTY_FORM, name: "SDN 3 Cibinong", fundingOfficerId: FO_ID };

describe("E2-S3 formatLocation: the coordinate line under the map", () => {
  it("four decimals, with the GPS accuracy in metres", () => {
    expect(formatLocation({ lat: -6.4817, lng: 106.854, accuracy: 12.4 })).toBe("-6.4817, 106.8540 (±12 m)");
  });

  it("no accuracy for a tapped or typed location", () => {
    expect(formatLocation({ lat: -6.48171234, lng: 106.85399, accuracy: null })).toBe("-6.4817, 106.8540");
  });

  it("a large accuracy uses the Indonesian thousands separator", () => {
    expect(formatLocation({ lat: -6.2, lng: 106.8, accuracy: 1250 })).toBe("-6.2000, 106.8000 (±1.250 m)");
  });
});

describe("E2-S3 coordinates typed under 'Masukkan koordinat'", () => {
  it("parses a dot or a comma decimal, and blank as null", () => {
    expect(parseCoordinate("-6.4817")).toBe(-6.4817);
    expect(parseCoordinate(" -6,4817 ")).toBe(-6.4817);
    expect(parseCoordinate("106")).toBe(106);
    expect(parseCoordinate("")).toBeNull();
    expect(parseCoordinate("abc")).toBeNaN();
    expect(parseCoordinate("1.2.3")).toBeNaN();
  });

  it("both blank is no location; one blank is required; text is invalid", () => {
    expect(coordinatesToLocation("", " ")).toEqual({ location: null, error: null });
    expect(coordinatesToLocation("-6.4817", "")).toEqual({ location: null, error: "Wajib diisi." });
    expect(coordinatesToLocation("-6.4817", "timur")).toEqual({ location: null, error: "Isian tidak valid." });
    expect(coordinatesToLocation("-6.4817", "106.854")).toEqual({
      location: { lat: -6.4817, lng: 106.854, accuracy: null },
      error: null,
    });
  });

  it("writes a coordinate back with at most six decimals", () => {
    expect(coordinateText(-6.481712345)).toBe("-6.481712");
    expect(coordinateText(106.854)).toBe("106.854");
  });
});

describe("E2-S3 Potensi rekening as typed (EC10)", () => {
  it("blank is null; whole numbers and '1.250' are numbers; anything else is invalid", () => {
    expect(parsePotentialAccounts(" ")).toBeNull();
    expect(parsePotentialAccounts("350")).toBe(350);
    expect(parsePotentialAccounts("1.250")).toBe(1250);
    expect(parsePotentialAccounts("100.000")).toBe(100_000);
    expect(parsePotentialAccounts("12,5")).toBe("invalid");
    expect(parsePotentialAccounts("-3")).toBe("invalid");
    expect(parsePotentialAccounts("1.25")).toBe("invalid");
  });
});

describe("E2-S3 toApiBody: the form's values as the API body", () => {
  it("maps every field; blank Category and location become null", () => {
    expect(
      toApiBody({
        ...filled,
        address: "Jl. Raya Bogor Km 43",
        contactName: "Ibu Sri Wahyuni",
        contactRole: "Kepala Sekolah",
        contactPhone: "0812 3456 7890",
        potentialAccounts: "350",
        note: "Minta brosur.",
      }),
    ).toEqual({
      name: "SDN 3 Cibinong",
      category: null,
      fundingOfficerId: FO_ID,
      address: "Jl. Raya Bogor Km 43",
      location: null,
      contact: { name: "Ibu Sri Wahyuni", role: "Kepala Sekolah", phone: "0812 3456 7890" },
      potentialAccounts: 350,
      note: "Minta brosur.",
    });
  });

  it("sends the location without the GPS accuracy", () => {
    const body = toApiBody({ ...filled, category: "sekolah", location: { lat: -6.4817, lng: 106.854, accuracy: 12 } });
    expect(body.location).toEqual({ lat: -6.4817, lng: 106.854 });
    expect(body.category).toBe("sekolah");
  });
});

describe("E2-S3 valuesFromRecord: the edit form prefilled from a Prospect", () => {
  const record: ProspectRecord = {
    id: "0b7e0000-0000-4000-8000-000000000000",
    name: "SDN 3 Cibinong",
    category: null,
    address: null,
    location: { lat: -6.4817, lng: 106.854 },
    contact: { name: "Ibu Sri Wahyuni", role: null, phone: "+6281234567890" },
    potentialAccounts: 0,
    fundingOfficer: { id: FO_ID, name: "Rina Kartika", active: false },
    note: null,
    archived: false,
    archivedAt: null,
    version: 3,
    createdAt: "2026-11-19T02:15:00.000Z",
    updatedAt: "2026-11-19T02:15:00.000Z",
  };

  it("nulls become blank, the phone is shown as dialled, 0 stays 0", () => {
    expect(valuesFromRecord(record)).toEqual({
      name: "SDN 3 Cibinong",
      fundingOfficerId: FO_ID,
      category: "",
      address: "",
      location: { lat: -6.4817, lng: 106.854, accuracy: null },
      contactName: "Ibu Sri Wahyuni",
      contactRole: "",
      contactPhone: "0812-3456-7890",
      potentialAccounts: "0",
      note: "",
    });
  });

  it("round-trips to the same API values", () => {
    const body = toApiBody(valuesFromRecord(record));
    expect(body).toMatchObject({ location: record.location, potentialAccounts: 0, category: null });
  });
});

describe("E2-S3 validateValues: the shared rules, checked before sending", () => {
  it("EC9: no name is 'Nama Prospect wajib diisi.' and Nama gets focus first", () => {
    const errors = validateValues({ ...EMPTY_FORM, fundingOfficerId: FO_ID, name: "   " });
    expect(errors.name).toBe("Nama Prospect wajib diisi.");
    expect(firstErrorField(errors)).toBe("name");
  });

  it("no Funding Officer is required", () => {
    expect(validateValues({ ...EMPTY_FORM, name: "SDN 3 Cibinong" }).fundingOfficerId).toBe("Wajib diisi.");
  });

  it("a filled form passes", () => {
    expect(validateValues({ ...filled, contactPhone: "0812 3456 7890", note: "Kunjungan 18-11-2026 10.30" })).toEqual({});
  });

  it("phone, customer numbers, Potensi rekening and a location outside Indonesia under their fields", () => {
    const errors = validateValues({
      ...filled,
      contactPhone: "12345",
      note: "NIK 3201 2345 6789 0001",
      potentialAccounts: "100001",
      location: { lat: -33.8688, lng: 151.2093, accuracy: null },
    });
    expect(errors).toEqual({
      "contact.phone": "Nomor telepon tidak valid. Contoh: 0812 3456 7890",
      note: "Jangan tulis NIK atau nomor rekening nasabah.",
      potentialAccounts: "Potensi rekening harus bilangan bulat 0 sampai 100.000.",
      location: "Lokasi di luar Indonesia.",
    });
    expect(firstErrorField(errors)).toBe("location");
  });

  it("a half-typed coordinate is an error under the map", () => {
    expect(validateValues(filled, "Wajib diisi.").location).toBe("Wajib diisi.");
  });

  it("text that is not a number in Potensi rekening", () => {
    expect(validateValues({ ...filled, potentialAccounts: "banyak" }).potentialAccounts).toBe(
      "Potensi rekening harus bilangan bulat 0 sampai 100.000.",
    );
  });
});

describe("E2-S3 toFieldErrors: the server's error keys on the form", () => {
  it("location.lat and location.lng show under the map; unknown keys are dropped", () => {
    expect(
      toFieldErrors({ "location.lat": "Wajib diisi.", "contact.phone": "Nomor telepon tidak valid.", version: "x", note: undefined }),
    ).toEqual({ location: "Wajib diisi.", "contact.phone": "Nomor telepon tidak valid." });
  });
});

describe("E2-S3 the note's 500-character limit (EC12)", () => {
  it("counts characters as the server does: an emoji counts once", () => {
    expect(characterCount("Rapat 👍")).toBe(7);
  });

  it("stops at 500 without splitting an emoji", () => {
    expect(limitCharacters("a".repeat(600))).toHaveLength(500);
    const withEmoji = `${"a".repeat(499)}👍👍`;
    expect(characterCount(limitCharacters(withEmoji))).toBe(500);
    expect(limitCharacters(withEmoji).endsWith("👍")).toBe(true);
    expect(limitCharacters("pendek")).toBe("pendek");
  });
});

import { describe, expect, it } from "vitest";
import {
  type ActivitySummary,
  activityQuery,
  appendActivityPage,
  archiveBlocked,
  canStartPipeline,
  closedPipelines,
  coordinateLine,
  defaultTemplateId,
  firstActivityPage,
  type PipelineSummary,
  runningPipeline,
  telHref,
} from "@/components/prospects/detail-state";
import {
  activityPath,
  editLocationPath,
  editProspectPath,
  newActivityPath,
  pipelinePath,
  PROSPECT_DETAIL_COPY as COPY,
} from "@/components/prospects/shared";
import { formatWeekdayDateTime } from "@/lib/format";

const officer = { id: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", name: "Rina Kartika", active: true };

function pipeline(id: string, outcome: PipelineSummary["outcome"], startedAt = "2026-11-01T02:00:00.000Z"): PipelineSummary {
  return {
    id,
    template: { id: "t1", name: "Umum" },
    fundingOfficer: officer,
    outcome,
    accountsOpened: outcome === "won" ? 350 : null,
    wonOn: outcome === "won" ? "2026-11-18" : null,
    lostReason: outcome === "lost" ? "Anggaran belum ada" : null,
    currentStage: { position: 3, name: "Presentasi" },
    stageCount: 5,
    tasksDone: 3,
    tasksTotal: 8,
    startedAt,
    closedAt: outcome === "won" || outcome === "lost" ? "2026-11-18T08:00:00.000Z" : null,
    version: 1,
  };
}

function activity(id: string, startsAt: string, status: ActivitySummary["status"], overdue = false): ActivitySummary {
  return { id, fundingOfficer: officer, startsAt, purpose: "Presentasi tabungan pelajar", status, overdue };
}

describe("E2-S4 #1: which Pipeline is 'Pipeline berjalan' and which are closed", () => {
  it("the open Pipeline is the one without an Outcome", () => {
    const open = pipeline("a", null);
    expect(runningPipeline([pipeline("b", "won"), open])).toBe(open);
  });

  it("an On Hold Pipeline is still the Prospect's running one (EC16)", () => {
    const held = pipeline("a", "on_hold");
    expect(runningPipeline([held, pipeline("b", "lost")])).toBe(held);
  });

  it("no running Pipeline when every one is Won or Lost", () => {
    expect(runningPipeline([pipeline("a", "won"), pipeline("b", "lost")])).toBeNull();
    expect(runningPipeline([])).toBeNull();
  });

  it("closed Pipelines are the Won and Lost ones, in the order given (newest first)", () => {
    const list = [pipeline("a", null), pipeline("b", "won"), pipeline("c", "on_hold"), pipeline("d", "lost")];
    expect(closedPipelines(list).map((item) => item.id)).toEqual(["b", "d"]);
  });
});

describe("E2-S4 #2: 'Mulai Pipeline' only with no open or On Hold Pipeline, and not archived (EC16)", () => {
  const live = { archived: false };

  it("offered with no Pipelines, or only closed ones", () => {
    expect(canStartPipeline(live, [])).toBe(true);
    expect(canStartPipeline(live, [pipeline("a", "won"), pipeline("b", "lost")])).toBe(true);
  });

  it("not offered with an open Pipeline", () => {
    expect(canStartPipeline(live, [pipeline("a", null)])).toBe(false);
  });

  it("not offered with an On Hold Pipeline", () => {
    expect(canStartPipeline(live, [pipeline("a", "on_hold")])).toBe(false);
  });

  it("not offered on an archived Prospect, even with nothing running", () => {
    expect(canStartPipeline({ archived: true }, [])).toBe(false);
    expect(canStartPipeline({ archived: true }, [pipeline("a", "won")])).toBe(false);
  });
});

describe("E2-S4 #3: archiving is blocked only by an open Pipeline (EC19)", () => {
  it("an open Pipeline blocks it", () => {
    expect(archiveBlocked([pipeline("a", null)])).toBe(true);
  });

  it("On Hold, Won and Lost do not (decided 2026-11-19)", () => {
    expect(archiveBlocked([pipeline("a", "on_hold"), pipeline("b", "won"), pipeline("c", "lost")])).toBe(false);
    expect(archiveBlocked([])).toBe(false);
  });

  it("the reason is the sentence the API sends too", () => {
    expect(COPY.archiveBlocked).toBe("Tutup atau tunda Pipeline dulu.");
  });
});

describe("E2-S4 #4: the archive confirmation says how many Kegiatan are cancelled (EC19)", () => {
  it("names the Prospect and the count", () => {
    expect(COPY.archiveQuestion("SDN 3 Cibinong")).toBe("Arsipkan SDN 3 Cibinong?");
    expect(COPY.archiveCancels("2")).toBe("2 Kegiatan mendatang akan dibatalkan.");
  });
});

describe("E2-S4 #1, BUG-5: Kegiatan lists read page by page, and nothing is dropped", () => {
  it("each list asks the server for its own view and optional cursor", () => {
    expect(activityQuery("p1", "upcoming")).toBe("prospectId=p1&view=upcoming");
    expect(activityQuery("p1", "history")).toBe("prospectId=p1&view=history");
    expect(activityQuery("p1", "history", "00000000-0000-4000-8000-000000000001")).toBe(
      "prospectId=p1&view=history&cursor=00000000-0000-4000-8000-000000000001",
    );
  });

  it("the first page keeps what the server said, hasMore included", () => {
    const first = firstActivityPage({ items: [activity("a", "2026-11-20T02:00:00.000Z", "scheduled")], hasMore: true });
    expect(first).toMatchObject({ hasMore: true, cursor: "a" });
    expect(first.items.map((item) => item.id)).toEqual(["a"]);
  });

  it("the next page is appended in order, and hasMore and cursor move on", () => {
    const first = firstActivityPage({ items: [activity("a", "2026-11-20T02:00:00.000Z", "scheduled")], hasMore: true });
    const second = appendActivityPage(first, { items: [activity("b", "2026-11-21T02:00:00.000Z", "scheduled")], hasMore: false });
    expect(second.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(second).toMatchObject({ hasMore: false, cursor: "b" });
  });

  it("a row both pages return (an Activity added in between shifted it) is listed once", () => {
    const first = firstActivityPage({ items: [activity("a", "2026-11-20T02:00:00.000Z", "scheduled")], hasMore: true });
    const second = appendActivityPage(first, {
      items: [activity("a", "2026-11-20T02:00:00.000Z", "scheduled"), activity("b", "2026-11-21T02:00:00.000Z", "scheduled")],
      hasMore: false,
    });
    expect(second.items.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("an Overdue Scheduled Activity stays in the upcoming list, flagged", () => {
    const overdue = activity("old", "2026-10-01T02:00:00.000Z", "scheduled", true);
    expect(firstActivityPage({ items: [overdue], hasMore: false }).items[0]).toMatchObject({ overdue: true, status: "scheduled" });
  });
});

describe("E2-S4: the Mulai Pipeline dialog's default template", () => {
  it("the only active template is chosen", () => {
    expect(defaultTemplateId([{ id: "t1", name: "Umum", archived: false }])).toBe("t1");
    expect(
      defaultTemplateId([
        { id: "t1", name: "Umum", archived: false },
        { id: "t2", name: "Lama", archived: true },
      ]),
    ).toBe("t1");
  });

  it("with several active templates, none is chosen: the Admin picks", () => {
    expect(
      defaultTemplateId([
        { id: "t1", name: "Umum", archived: false },
        { id: "t2", name: "Sekolah", archived: false },
      ]),
    ).toBe("");
  });

  it("with none, nothing is chosen", () => {
    expect(defaultTemplateId([])).toBe("");
    expect(defaultTemplateId([{ id: "t2", name: "Lama", archived: true }])).toBe("");
  });
});

describe("E2-S4 #1: tap-to-call", () => {
  it("dials the stored +62 number", () => {
    expect(telHref("+6281234567890")).toBe("tel:+6281234567890");
  });

  it("the accessible name reads the contact and the number", () => {
    expect(COPY.call("Ibu Sri Wahyuni", "0812-3456-7890")).toBe("Telepon Ibu Sri Wahyuni, 0812-3456-7890");
    expect(COPY.call(null, "0812-3456-7890")).toBe("Telepon 0812-3456-7890");
  });
});

describe("E2-S4: formats and links", () => {
  it("a Kegiatan time is weekday, date and WIB time", () => {
    expect(formatWeekdayDateTime("2026-11-20T02:00:00.000Z")).toBe("Jum, 20 Nov 2026, 09.00 WIB");
  });

  it("the day is the WIB day, not the UTC one", () => {
    expect(formatWeekdayDateTime("2026-11-19T18:30:00.000Z")).toBe("Jum, 20 Nov 2026, 01.30 WIB");
  });

  it("the mini map line has four decimals", () => {
    expect(coordinateLine({ lat: -6.4817, lng: 106.854 })).toBe("-6.4817, 106.8540");
  });

  it("paths: Pipeline, Kegiatan, new Kegiatan and the edit form's Lokasi section (EC34)", () => {
    expect(pipelinePath("p1")).toBe("/pipeline/p1");
    expect(activityPath("a1")).toBe("/kegiatan/a1");
    expect(newActivityPath("x1")).toBe("/jadwal?tambah=1&prospectId=x1");
    expect(editLocationPath("x1")).toBe(`${editProspectPath("x1")}#lokasi`);
  });
});

describe("E2-S4 #5: archived and missing Prospects (EC40)", () => {
  it("copy matches the design", () => {
    expect(COPY.archivedOn("12 Nov 2026")).toBe("Prospect ini diarsipkan pada 12 Nov 2026.");
    expect(COPY.restore).toBe("Pulihkan");
    expect(COPY.archived).toBe("Diarsipkan");
    expect(COPY.notFound).toBe("Prospect tidak ditemukan. Mungkin alamatnya salah.");
    expect(COPY.backToList).toBe("Kembali ke daftar Prospect");
  });
});

describe("BUG-5 #2: the detail screen never carries one Prospect's state to another", () => {
  it("renders its inner screen keyed by the Prospect ID, so another ID remounts it from the loading state", async () => {
    const { ProspectDetailScreen } = await import("@/components/prospects/prospect-detail-screen");
    const a = ProspectDetailScreen({ prospectId: "0b7e0000-0000-4000-8000-00000000000a" }) as { key: string | null; props: { prospectId: string } };
    const b = ProspectDetailScreen({ prospectId: "0b7e0000-0000-4000-8000-00000000000b" }) as { key: string | null; props: { prospectId: string } };
    // React keeps state only while the key and the type stay the same.
    expect(a.key).toBe("0b7e0000-0000-4000-8000-00000000000a");
    expect(b.key).toBe("0b7e0000-0000-4000-8000-00000000000b");
    expect(a.key).not.toBe(b.key);
    expect(a.props.prospectId).toBe(a.key);
  });
});

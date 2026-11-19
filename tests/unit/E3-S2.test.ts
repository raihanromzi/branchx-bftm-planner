import { describe, expect, it } from "vitest";
import {
  type EditorStage,
  type EditorValues,
  firstErrorKey,
  isDirty,
  moveItem,
  newTemplateValues,
  type PipelineTemplateRecord,
  stageMovedMessage,
  stageNameKey,
  stageTasksKey,
  taskMovedMessage,
  taskNameKey,
  toApiBody,
  toEditorErrors,
  validateValues,
  valuesFromRecord,
} from "@/components/pipeline-templates/editor-state";
import { TEMPLATE_COPY } from "@/components/pipeline-templates/shared";

const record: PipelineTemplateRecord = {
  id: "3c9e0000-0000-4000-8000-000000000001",
  name: "Sekolah",
  archived: false,
  archivedAt: null,
  pipelineCount: 0,
  version: 3,
  createdAt: "2026-11-19T02:15:00.000Z",
  updatedAt: "2026-11-19T02:15:00.000Z",
  stages: [
    { id: "s2", position: 2, name: "Presentasi", tasks: [] },
    {
      id: "s1",
      position: 1,
      name: "Identifikasi",
      tasks: [
        { id: "t2", position: 2, name: "Hubungi kepala sekolah" },
        { id: "t1", position: 1, name: "Cari data sekolah" },
      ],
    },
  ],
};

const stages = (values: EditorValues) => values.stages;

describe("E3-S2 form ↔ API mapping", () => {
  it("reads Stages and Tasks in position order and writes them back in that order, without ids", () => {
    const values = valuesFromRecord(record);
    expect(toApiBody(values)).toEqual({
      name: "Sekolah",
      stages: [
        { name: "Identifikasi", tasks: [{ name: "Cari data sekolah" }, { name: "Hubungi kepala sekolah" }] },
        { name: "Presentasi", tasks: [] },
      ],
    });
  });

  it("gives every Stage and Task its own editor key", () => {
    const values = valuesFromRecord(record);
    const keys = [...stages(values).map((stage) => stage.key), ...stages(values).flatMap((stage) => stage.tasks.map((task) => task.key))];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a new template starts with one empty Stage", () => {
    const values = newTemplateValues();
    expect(toApiBody(values)).toEqual({ name: "", stages: [{ name: "", tasks: [] }] });
  });

  it("isDirty: false as loaded, true after a rename or a reorder", () => {
    const initial = valuesFromRecord(record);
    expect(isDirty(initial, initial)).toBe(false);
    expect(isDirty({ ...initial, name: "Sekolah Dasar" }, initial)).toBe(true);
    expect(isDirty({ ...initial, stages: moveItem(initial.stages, 0, 1) }, initial)).toBe(true);
  });
});

describe("E3-S2 moveItem (reorder)", () => {
  const list = ["Identifikasi", "Pendekatan", "Presentasi"];

  it("moves up and down", () => {
    expect(moveItem(list, 0, 1)).toEqual(["Pendekatan", "Identifikasi", "Presentasi"]);
    expect(moveItem(list, 2, 0)).toEqual(["Presentasi", "Identifikasi", "Pendekatan"]);
  });

  it("does not change the input and clamps past the ends", () => {
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 2, 5)).toBe(list);
    expect(list).toEqual(["Identifikasi", "Pendekatan", "Presentasi"]);
  });
});

describe("E3-S2 field-error keys", () => {
  const sent: EditorStage[] = [
    { key: "a", name: "Identifikasi", tasks: [{ key: "a1", name: "" }] },
    { key: "b", name: "", tasks: [] },
  ];

  it("maps 0-based API paths onto the Stage and Task that were sent", () => {
    const { errors, other } = toEditorErrors(
      {
        name: "Nama template sudah dipakai.",
        "stages.1.name": "Nama Tahap wajib diisi.",
        "stages.0.tasks.0.name": "Nama Tugas wajib diisi.",
        "stages.0.tasks": "Maksimal 30 Tugas per Tahap.",
        version: "Isian tidak valid.",
      },
      sent,
    );
    expect(errors).toEqual({
      name: "Nama template sudah dipakai.",
      [stageNameKey("b")]: "Nama Tahap wajib diisi.",
      [taskNameKey("a1")]: "Nama Tugas wajib diisi.",
      [stageTasksKey("a")]: "Maksimal 30 Tugas per Tahap.",
    });
    expect(other).toEqual(["Isian tidak valid."]);
  });

  it("keeps the empty-Stages message for the top of the list (EC3)", () => {
    expect(toEditorErrors({ stages: "Tambahkan minimal satu Stage." }, []).errors).toEqual({
      stages: "Tambahkan minimal satu Stage.",
    });
  });

  it("an index the editor did not send is not lost", () => {
    expect(toEditorErrors({ "stages.7.name": "Nama Tahap wajib diisi." }, sent).other).toEqual(["Nama Tahap wajib diisi."]);
  });
});

describe("E3-S2 inline checks (the server's rules)", () => {
  it("names the blank template name, Stage name and Task name, and finds the first one on screen", () => {
    const values: EditorValues = {
      name: " ",
      stages: [
        { key: "a", name: "Identifikasi", tasks: [{ key: "a1", name: "" }] },
        { key: "b", name: "", tasks: [] },
      ],
    };
    const errors = validateValues(values);
    expect(errors).toEqual({
      name: "Nama template wajib diisi.",
      [taskNameKey("a1")]: "Nama Tugas wajib diisi.",
      [stageNameKey("b")]: "Nama Tahap wajib diisi.",
    });
    expect(firstErrorKey(errors, values)).toBe("name");
    expect(firstErrorKey({ ...errors, name: undefined }, values)).toBe(taskNameKey("a1"));
  });

  it("no Stages: 'Tambahkan minimal satu Stage.' (EC3)", () => {
    expect(validateValues({ name: "Sekolah", stages: [] })).toEqual({ stages: "Tambahkan minimal satu Stage." });
  });

  it("a filled template passes", () => {
    expect(validateValues(valuesFromRecord(record))).toEqual({});
  });
});

describe("E3-S2 copy", () => {
  it("announces a move and counts in Indonesian formats", () => {
    expect(stageMovedMessage("Identifikasi", 2)).toBe("Identifikasi sekarang tahap 2.");
    expect(stageMovedMessage("  ", 1)).toBe("Tahap tanpa nama sekarang tahap 1.");
    expect(taskMovedMessage("Hubungi Kontak", 1, "Pendekatan")).toBe("Hubungi Kontak sekarang tugas 1 di Pendekatan.");
    expect(TEMPLATE_COPY.stageCount(5)).toBe("5 Tahap");
    expect(TEMPLATE_COPY.pipelineCount(1250)).toBe("1.250 Pipeline memakai");
    expect(TEMPLATE_COPY.moveUp("Identifikasi")).toBe("Pindahkan Identifikasi ke atas");
    expect(TEMPLATE_COPY.moveDown("Identifikasi")).toBe("Pindahkan Identifikasi ke bawah");
  });
});

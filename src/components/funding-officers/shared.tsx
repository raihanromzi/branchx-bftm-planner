import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";

/** A Funding Officer as the API returns it (api.md, "The record"). */
export type FundingOfficer = {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export const FUNDING_OFFICERS_PATH = "/api/funding-officers";
export const SCREEN_PATH = "/pengaturan/funding-officer";

/** Copy from docs/design/E1-S2.md. */
export const FO_COPY = {
  title: "Funding Officer",
  add: "Tambah Funding Officer",
  addShort: "Tambah",
  edit: "Ubah",
  editTitle: "Ubah Funding Officer",
  deactivate: "Nonaktifkan",
  reactivate: "Aktifkan lagi",
  save: "Simpan",
  cancel: "Batal",
  name: "Nama",
  phone: "Telepon",
  inactive: "Nonaktif",
  active: "Aktif",
  status: "Status",
  actions: "Aksi",
  empty:
    "Belum ada Funding Officer. Prospect, Pipeline, dan Kegiatan ditugaskan ke Funding Officer, jadi tambahkan tim Anda dulu.",
  loadError: "Daftar Funding Officer gagal dimuat.",
  retry: "Coba lagi",
  reload: "Muat ulang",
  deactivateQuestion: (name: string) => `Nonaktifkan ${name}?`,
  deactivateConsequence: "Ia tidak bisa ditugaskan pekerjaan baru.",
  actionsFor: (name: string) => `Aksi untuk ${name}`,
} as const;

/** Active first, then inactive; each group by name ignoring case (the list endpoint's order). */
export function sortFundingOfficers(items: FundingOfficer[]): FundingOfficer[] {
  return [...items].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      a.name.localeCompare(b.name, "id", { sensitivity: "base" }) ||
      a.id.localeCompare(b.id),
  );
}

/** A message in a form or dialog, with an optional action such as "Muat ulang". */
export function InlineAlert({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <Alert
      variant="destructive"
      className="border-danger/40 px-3 py-2.5 text-base text-danger *:[svg]:size-5 *:[svg]:translate-y-0.5"
    >
      <CircleAlert aria-hidden />
      <div className="flex flex-col items-start gap-2">
        <p>{message}</p>
        {action}
      </div>
    </Alert>
  );
}

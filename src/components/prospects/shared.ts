import { PROSPECT_CATEGORY_LABELS, type ProspectCategory } from "@/lib/validation";

export const PROSPECTS_PATH = "/api/prospects";
export const SCREEN_PATH = "/prospect";
export const NEW_PROSPECT_PATH = "/prospect/baru";
export const prospectPath = (id: string) => `/prospect/${id}`;
export const editProspectPath = (id: string) => `/prospect/${id}/ubah`;
export const FUNDING_OFFICER_SETTINGS_PATH = "/pengaturan/funding-officer";

/**
 * The open (or On Hold) Pipeline's Stage on a list row. Always null until E3-S3 fills it (E3-S3 #9:
 * "Stage name, position and Stage count"); the shape is recorded in api.md, Prospects list row.
 */
export type OpenPipelineStage = {
  stageName: string;
  /** 1-based position of the current Stage in the Pipeline. */
  stagePosition: number;
  stageCount: number;
};

/** A row of GET /api/prospects (api.md, Prospects). */
export type ProspectRow = {
  id: string;
  name: string;
  category: ProspectCategory | null;
  fundingOfficer: { id: string; name: string; active: boolean };
  hasLocation: boolean;
  potentialAccounts: number | null;
  archived: boolean;
  openPipeline: OpenPipelineStage | null;
};

export type ProspectPage = { items: ProspectRow[]; page: number; pageSize: number; total: number };

/** A Funding Officer as the filter needs it (GET /api/funding-officers). */
export type FundingOfficerOption = { id: string; name: string; active: boolean };

export const categoryLabel = (category: ProspectCategory | null) =>
  category ? PROSPECT_CATEGORY_LABELS[category] : null;

/** Copy from docs/design/E2-S2.md. */
export const PROSPECT_COPY = {
  title: "Prospect",
  add: "Tambah Prospect",
  addShort: "Tambah",
  searchLabel: "Cari Prospect",
  searchPlaceholder: "Cari nama Prospect",
  filters: "Filter",
  category: "Kategori",
  allCategories: "Semua kategori",
  fundingOfficer: "Funding Officer",
  allFundingOfficers: "Semua Funding Officer",
  selectedFundingOfficer: "Funding Officer terpilih",
  inactiveSuffix: " (nonaktif)",
  showArchived: "Tampilkan arsip",
  count: (total: string) => `${total} Prospect`,
  list: "Daftar Prospect",
  noPipeline: "Belum ada Pipeline",
  noLocation: "Belum ada lokasi",
  archived: "Diarsipkan",
  inactiveOfficer: "Funding Officer nonaktif",
  inactiveOfficerPrefix: "Funding Officer ",
  inactiveShort: "nonaktif",
  noCategory: "Tanpa kategori",
  noPotential: "Potensi rekening belum diisi",
  previous: "Sebelumnya",
  next: "Berikutnya",
  pages: "Halaman",
  pageOf: (page: string, pages: string) => `Halaman ${page} dari ${pages}`,
  empty:
    "Belum ada Prospect. Prospect adalah sekolah, pasar, perusahaan, atau instansi yang ingin dibukakan rekening oleh tim Anda.",
  noResultsFor: (q: string) => `Tidak ada Prospect yang cocok dengan "${q}".`,
  noResults: "Tidak ada Prospect yang cocok dengan filter ini.",
  clearFilters: "Hapus filter",
  loadError: "Daftar Prospect gagal dimuat. Periksa koneksi, lalu coba lagi.",
  retry: "Coba lagi",
  loading: "Memuat daftar Prospect…",
  columns: {
    name: "Nama",
    stage: "Tahap",
    fundingOfficer: "Funding Officer",
    category: "Kategori",
    potential: "Potensi rekening",
    location: "Lokasi",
  },
  locationYes: "Ada",
  locationNo: "Belum ada",
  locationNoSuffix: " lokasi",
} as const;

/** Copy from docs/design/E2-S3.md (the Prospect form). */
export const PROSPECT_FORM_COPY = {
  newTitle: "Tambah Prospect",
  editTitle: "Ubah Prospect",
  requiredNote: "* wajib diisi",
  name: "Nama Prospect",
  fundingOfficer: "Funding Officer",
  chooseFundingOfficer: "Pilih Funding Officer",
  inactiveSuffix: " (nonaktif)",
  category: "Kategori",
  chooseCategory: "Pilih kategori",
  location: "Lokasi",
  useMyLocation: "Gunakan lokasi saya",
  locating: "Mencari lokasi…",
  clearLocation: "Hapus lokasi",
  noLocation: "Belum ada lokasi.",
  mapLabel: "Peta lokasi Prospect. Ketuk peta untuk menandai lokasi.",
  gpsDenied: "Izin lokasi ditolak. Ketuk peta untuk menandai lokasi.",
  gpsFailed: "Lokasi belum didapat. Ketuk peta untuk menandai lokasi.",
  enterCoordinates: "Masukkan koordinat",
  latitude: "Lintang",
  longitude: "Bujur",
  address: "Alamat",
  contact: "Kontak",
  contactName: "Nama",
  contactRole: "Jabatan",
  contactPhone: "Telepon",
  potentialAccounts: "Potensi rekening",
  note: "Catatan",
  noteHint: "Jangan tulis nama, NIK, atau nomor rekening nasabah.",
  save: "Simpan",
  saving: "Menyimpan…",
  cancel: "Batal",
  saved: "Prospect disimpan.",
  saveFailed: "Gagal menyimpan. Periksa koneksi lalu coba lagi.",
  retry: "Coba lagi",
  reload: "Muat ulang",
  noActiveOfficers:
    "Tambahkan Funding Officer dulu. Setiap Prospect perlu ditugaskan ke satu Funding Officer.",
  openOfficerSettings: "Buka Pengaturan Funding Officer",
  loadError: "Formulir Prospect gagal dimuat. Periksa koneksi, lalu coba lagi.",
  loading: "Memuat formulir Prospect…",
  notFound: "Prospect ini tidak ditemukan. Mungkin alamatnya salah.",
  backToList: "Kembali ke daftar Prospect",
  archived: "Prospect ini diarsipkan. Pulihkan dulu untuk mengubahnya.",
  openProspect: "Buka Prospect",
  duplicateTitle: (name: string) => `Sudah ada Prospect bernama ${name}`,
  duplicateCreated: "Prospect baru sudah tersimpan. Periksa Prospect yang sudah ada, lalu pilih:",
  duplicateUpdated: "Perubahan sudah tersimpan. Periksa Prospect yang sudah ada, lalu pilih:",
  duplicateOpen: (name: string) => `Buka ${name}`,
  keepBoth: "Tetap simpan",
  discardNew: "Batalkan Prospect baru",
  discardNewHint: "Prospect baru akan diarsipkan.",
  discarded: "Prospect baru dibatalkan dan diarsipkan.",
  discardFailed: "Gagal membatalkan. Periksa koneksi lalu coba lagi.",
  renameAgain: "Ubah nama",
} as const;

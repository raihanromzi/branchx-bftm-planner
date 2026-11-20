import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/page-header";

// Placeholder inside the app shell, so the Prospect detail's Kegiatan rows are not broken links. Story
// E4-S2 builds the Activity detail.
export const metadata: Metadata = { title: "Kegiatan" };

export default function ActivityDetailPage() {
  return <PlaceholderPage title="Kegiatan" description="Detail Kegiatan akan tampil di sini. Layar ini sedang disiapkan." />;
}

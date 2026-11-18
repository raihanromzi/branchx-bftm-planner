import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/page-header";

// Placeholder inside the app shell (E0-S4). Story E4-S2 builds this screen.
export const metadata: Metadata = { title: "Jadwal" };

export default function SchedulePage() {
  return (
    <PlaceholderPage
      title="Jadwal"
      description="Jadwal Kegiatan akan tampil di sini. Layar ini sedang disiapkan."
    />
  );
}

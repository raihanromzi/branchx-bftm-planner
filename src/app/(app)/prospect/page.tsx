import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/page-header";

// Placeholder inside the app shell (E0-S4). Story E2-S2 builds this screen.
export const metadata: Metadata = { title: "Prospect" };

export default function ProspectPage() {
  return (
    <PlaceholderPage
      title="Prospect"
      description="Daftar Prospect akan tampil di sini. Layar ini sedang disiapkan."
    />
  );
}

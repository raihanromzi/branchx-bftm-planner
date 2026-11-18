import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/page-header";

// Placeholder inside the app shell (E0-S4). Story E6-S2 builds this screen.
export const metadata: Metadata = { title: "Peta" };

export default function MapPage() {
  return (
    <PlaceholderPage
      title="Peta"
      description="Peta Prospect akan tampil di sini. Layar ini sedang disiapkan."
    />
  );
}

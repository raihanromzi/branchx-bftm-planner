import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/page-header";

// Placeholder inside the app shell (E0-S4). Story E1-S2 builds this screen.
export const metadata: Metadata = { title: "Funding Officer" };

export default function FundingOfficerSettingsPage() {
  return (
    <PlaceholderPage
      title="Funding Officer"
      description="Daftar Funding Officer akan tampil di sini. Layar ini sedang disiapkan."
    />
  );
}

import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/page-header";

// Placeholder inside the app shell (E0-S4). Story E5-S2 builds this screen.
export const metadata: Metadata = { title: "Target" };

export default function TargetSettingsPage() {
  return (
    <PlaceholderPage
      title="Target"
      description="Target bulanan akan tampil di sini. Layar ini sedang disiapkan."
    />
  );
}

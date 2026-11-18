import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/page-header";

// Placeholder inside the app shell (E0-S4). Story E3-S2 builds this screen.
export const metadata: Metadata = { title: "Template Pipeline" };

export default function PipelineTemplateSettingsPage() {
  return (
    <PlaceholderPage
      title="Template Pipeline"
      description="Tahap dan Tugas di Template Pipeline akan tampil di sini. Layar ini sedang disiapkan."
    />
  );
}

import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/page-header";

// Placeholder inside the app shell, so the Prospect detail's "Buka Pipeline" links are not broken. Story
// E3-S4 builds the Pipeline detail.
export const metadata: Metadata = { title: "Pipeline" };

export default function PipelineDetailPage() {
  return <PlaceholderPage title="Pipeline" description="Detail Pipeline akan tampil di sini. Layar ini sedang disiapkan." />;
}

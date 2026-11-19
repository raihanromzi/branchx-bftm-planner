import type { Metadata } from "next";
import { TemplateListScreen } from "@/components/pipeline-templates/template-list-screen";

// Pengaturan → Template Pipeline (E3-S2). The app shell's AdminGate has already checked the session; the
// screen reads the list from GET /api/pipeline-templates on the client (ADR 0003, client-side reads).
export const metadata: Metadata = { title: "Template Pipeline" };

export default function PipelineTemplateSettingsPage() {
  return <TemplateListScreen />;
}

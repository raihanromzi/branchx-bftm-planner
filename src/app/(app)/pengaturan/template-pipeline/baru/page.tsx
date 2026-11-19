import type { Metadata } from "next";
import { TemplateEditorScreen } from "@/components/pipeline-templates/template-editor-screen";

// Tambah Template (E3-S2): starts with one empty Stage and saves with POST /api/pipeline-templates.
export const metadata: Metadata = { title: "Tambah Template" };

export default function NewPipelineTemplatePage() {
  return <TemplateEditorScreen />;
}

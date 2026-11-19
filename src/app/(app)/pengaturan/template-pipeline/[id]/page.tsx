import type { Metadata } from "next";
import { TemplateEditorScreen } from "@/components/pipeline-templates/template-editor-screen";

// Ubah Template (E3-S2). The editor reads the template on the client (ADR 0003) and saves the whole template
// with PUT /api/pipeline-templates/:id and the version it loaded.
export const metadata: Metadata = { title: "Ubah Template" };

// A dynamic segment, and the app shell reads the pathname outside a Suspense boundary: block on the
// request instead of prerendering a shell, like /prospect/[id] (backlog Follow-ups; E2-S4 fixes the shell).
export const instant = false;

export default async function EditPipelineTemplatePage({ params }: PageProps<"/pengaturan/template-pipeline/[id]">) {
  const { id } = await params;
  return <TemplateEditorScreen templateId={id} />;
}

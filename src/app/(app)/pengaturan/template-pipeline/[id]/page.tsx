import type { Metadata } from "next";
import { Suspense } from "react";
import { TemplateEditorScreen } from "@/components/pipeline-templates/template-editor-screen";
import { ContentSkeleton } from "@/components/shell/page-header";

// Ubah Template (E3-S2). The editor reads the template on the client (ADR 0003) and saves the whole template
// with PUT /api/pipeline-templates/:id and the version it loaded. `params` is read inside a Suspense boundary
// (see /prospect/[id]).
export const metadata: Metadata = { title: "Ubah Template" };

export default function EditPipelineTemplatePage({ params }: PageProps<"/pengaturan/template-pipeline/[id]">) {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <Screen params={params} />
    </Suspense>
  );
}

async function Screen({ params }: { params: PageProps<"/pengaturan/template-pipeline/[id]">["params"] }) {
  const { id } = await params;
  return <TemplateEditorScreen key={id} templateId={id} />;
}

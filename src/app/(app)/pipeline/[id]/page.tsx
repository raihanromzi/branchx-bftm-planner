import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/server/auth/page";
import { getPipeline } from "@/server/pipelines";
import { getProspect } from "@/server/prospects";
import { PipelineDetail } from "@/components/pipelines/pipeline-detail";

async function PipelineContent({ id }: { id: string }) {
  const pipeline = await getPipeline(id).catch((error: unknown) => {
    if ((error as { code?: string })?.code === "not_found") notFound();
    throw error;
  });
  const prospect = await getProspect(pipeline.prospect.id).catch((error: unknown) => {
    if ((error as { code?: string })?.code === "not_found") notFound();
    throw error;
  });
  return <PipelineDetail pipeline={pipeline} prospect={prospect} />;
}

export default async function PipelinePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage("/pipeline/[id]");
  const { id } = await params;

  return (
    <Suspense fallback={<PipelineDetailSkeleton />}>
      <PipelineContent id={id} />
    </Suspense>
  );
}

function PipelineDetailSkeleton() {
  return <div className="p-4">Memuat...</div>; // ponytail: placeholder, replace with real skeleton
}

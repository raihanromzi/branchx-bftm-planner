import type { Metadata } from "next";
import { Suspense } from "react";
import { ProspectDetailScreen } from "@/components/prospects/prospect-detail-screen";
import { ContentSkeleton } from "@/components/shell/page-header";

// Detail Prospect (E2-S4). The screen reads the Prospect, its Pipelines and its Activities on the client
// (ADR 0003). `params` is request-time data, so it is read inside a Suspense boundary (the "stream" fix of
// Next.js's instant-shell-url-data message): the shell and the skeleton are the instant part.
export const metadata: Metadata = { title: "Detail Prospect" };

export default function ProspectDetailPage({ params }: PageProps<"/prospect/[id]">) {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <Screen params={params} />
    </Suspense>
  );
}

async function Screen({ params }: { params: PageProps<"/prospect/[id]">["params"] }) {
  const { id } = await params;
  // Keyed by ID, so moving between two Prospects starts from a clean screen instead of the last one's data.
  return <ProspectDetailScreen key={id} prospectId={id} />;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { ProspectFormScreen } from "@/components/prospects/prospect-form-screen";
import { ContentSkeleton } from "@/components/shell/page-header";

// Ubah Prospect (E2-S3). The form reads the Prospect and the Funding Officers on the client (ADR 0003) and
// saves with PATCH /api/prospects/:id and the version it loaded. `params` is read inside a Suspense boundary
// (see /prospect/[id]).
export const metadata: Metadata = { title: "Ubah Prospect" };

export default function EditProspectPage({ params }: PageProps<"/prospect/[id]/ubah">) {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <Screen params={params} />
    </Suspense>
  );
}

async function Screen({ params }: { params: PageProps<"/prospect/[id]/ubah">["params"] }) {
  const { id } = await params;
  return <ProspectFormScreen key={id} prospectId={id} />;
}

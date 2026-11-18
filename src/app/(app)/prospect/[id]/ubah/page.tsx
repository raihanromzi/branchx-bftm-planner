import type { Metadata } from "next";
import { ProspectFormScreen } from "@/components/prospects/prospect-form-screen";

// Ubah Prospect (E2-S3). The form reads the Prospect and the Funding Officers on the client (ADR 0003) and
// saves with PATCH /api/prospects/:id and the version it loaded.
export const metadata: Metadata = { title: "Ubah Prospect" };

// A dynamic segment, and the app shell reads the pathname outside a Suspense boundary: block on the
// request instead of prerendering a shell, like /prospect/[id] (backlog Follow-ups; E2-S4 fixes the shell).
export const instant = false;

export default async function EditProspectPage({ params }: PageProps<"/prospect/[id]/ubah">) {
  const { id } = await params;
  return <ProspectFormScreen prospectId={id} />;
}

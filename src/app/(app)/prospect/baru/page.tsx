import type { Metadata } from "next";
import { ProspectFormScreen } from "@/components/prospects/prospect-form-screen";

// Tambah Prospect (E2-S3). The app shell's AdminGate has already checked the session; the form reads the
// Funding Officers on the client (ADR 0003, client-side reads) and saves with POST /api/prospects.
export const metadata: Metadata = { title: "Tambah Prospect" };

export default function NewProspectPage() {
  return <ProspectFormScreen />;
}

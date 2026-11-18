import type { Metadata } from "next";
import { Suspense } from "react";
import { ProspectListScreen } from "@/components/prospects/prospect-list-screen";
import { ContentSkeleton } from "@/components/shell/page-header";

// The Prospect list (E2-S2). The app shell's AdminGate has already checked the session. The screen reads
// its search, filters and page from the URL (useSearchParams, so it sits in a Suspense boundary) and the
// list from GET /api/prospects on the client (ADR 0003, client-side reads).
export const metadata: Metadata = { title: "Prospect" };

export default function ProspectPage() {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <ProspectListScreen />
    </Suspense>
  );
}

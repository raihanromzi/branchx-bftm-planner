import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/shell/page-header";

// Placeholder inside the app shell, so the list's row links are not broken. E2-S4 builds the detail page.
export const metadata: Metadata = { title: "Detail Prospect" };

// The first route with a dynamic segment: its pathname is known only at request time, and the app shell's
// navigation reads it (usePathname) outside a Suspense boundary. Let this route block on the request
// instead of prerendering a shell (Next.js 16 `instant`). E2-S4 revisits this with the real page.
export const instant = false;

export default function ProspectDetailPage() {
  return (
    <>
      <PageHeader title="Detail Prospect" backHref="/prospect" />
      <PageBody>
        <p className="max-w-prose text-base text-muted-foreground">Detail Prospect sedang disiapkan.</p>
      </PageBody>
    </>
  );
}

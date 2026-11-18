import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/shell/page-header";

// Placeholder inside the app shell, so the list's "Tambah Prospect" link is not broken. E2-S3 builds the form.
export const metadata: Metadata = { title: "Tambah Prospect" };

export default function NewProspectPage() {
  return (
    <>
      <PageHeader title="Tambah Prospect" backHref="/prospect" />
      <PageBody>
        <p className="max-w-prose text-base text-muted-foreground">Formulir Prospect sedang disiapkan.</p>
      </PageBody>
    </>
  );
}

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The page title (docs/design/E0-S4.md). Below 1024 px it is the 56 px top bar: 20 px, one line, with an
 * optional back control. From 1024 px it is the page header row: 28 px, with the page's primary action on
 * the right. A truncated title must be repeated in full as the page's first heading below it.
 */
export function PageHeader({
  title,
  backHref,
  action,
}: {
  title: string;
  backHref?: string;
  action?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-(--top-bar-height) items-center gap-2 border-b border-border bg-background px-4 lg:static lg:h-auto lg:gap-4 lg:border-0 lg:px-6 lg:pt-6 lg:pb-4">
      {backHref && (
        <Link
          href={backHref}
          aria-label="Kembali"
          className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-accent"
        >
          <ArrowLeft aria-hidden className="size-6" />
        </Link>
      )}
      <h1 className="min-w-0 flex-1 truncate text-xl font-semibold lg:text-2xl lg:whitespace-normal">{title}</h1>
      {action && <div className="hidden shrink-0 lg:block">{action}</div>}
    </header>
  );
}

/** The content area under the header, with the 16 px (mobile) and 24 px (desktop) gutter. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4 px-4 py-4 lg:px-6 lg:pt-0">{children}</div>;
}

/** A screen that a later story builds: its title and one muted sentence, no sample data. */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} />
      <PageBody>
        <p className="max-w-prose text-base text-muted-foreground">{description}</p>
      </PageBody>
    </>
  );
}

/** While a page loads, only the content area shows skeletons; the navigation stays in place. */
export function ContentSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="flex h-(--top-bar-height) items-center border-b border-border px-4 lg:h-auto lg:border-0 lg:px-6 lg:pt-6 lg:pb-4">
        <div className="h-6 w-32 rounded-lg bg-muted lg:h-8 lg:w-48" />
      </div>
      <div className="flex flex-col gap-3 px-4 lg:px-6">
        <div className="h-5 w-full max-w-md rounded-lg bg-muted" />
        <div className="h-5 w-2/3 max-w-sm rounded-lg bg-muted" />
      </div>
    </div>
  );
}

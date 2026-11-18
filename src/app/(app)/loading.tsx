import { ContentSkeleton } from "@/components/shell/page-header";

// Shown at once on navigation inside the shell, while the next page loads (E0-S4, Loading state).
export default function Loading() {
  return <ContentSkeleton />;
}

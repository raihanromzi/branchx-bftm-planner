import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/shell/page-header";

// The dashboard, the shell's home (E0-S4). Story E5-S3 builds it.
export const metadata: Metadata = { title: "Dasbor" };

export default function DashboardPage() {
  return (
    <PlaceholderPage
      title="Dasbor"
      description="Ringkasan Target, Realisasi dan jadwal bulan ini akan tampil di sini. Layar ini sedang disiapkan."
    />
  );
}

import type { Metadata } from "next";
import { FundingOfficerScreen } from "@/components/funding-officers/funding-officer-screen";

// Pengaturan → Funding Officer (E1-S2). The app shell's AdminGate has already checked the session; the
// screen reads the list from GET /api/funding-officers on the client (ADR 0003, client-side reads).
export const metadata: Metadata = { title: "Funding Officer" };

export default function FundingOfficerSettingsPage() {
  return <FundingOfficerScreen />;
}

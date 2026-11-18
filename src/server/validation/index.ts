// Server entry point for the shared input rules (E0-S6). The rules live in src/lib/validation so
// client forms reuse them for inline checks (ADR 0003); the server always validates again.
export * from "@/lib/validation";

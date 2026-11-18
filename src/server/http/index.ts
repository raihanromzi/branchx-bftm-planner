// Shared Route Handler plumbing (ADR 0003): error shape, request parsing, Origin check,
// idempotent creates and version-checked updates. Conventions are documented in docs/product/api.md.
export * from "./errors";
export * from "./request";
export * from "./idempotency";
export * from "./version";

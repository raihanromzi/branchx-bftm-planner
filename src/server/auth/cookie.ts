// Session cookie name and lifetime. Kept free of database imports so proxy.ts can use them.

export const SESSION_COOKIE = "bftm_session";
/** 30 days. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

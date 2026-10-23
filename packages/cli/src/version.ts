declare const __RELAY_VERSION__: string | undefined;

/** Set at build time from package.json; "dev" when running from source with tsx. */
export const VERSION = typeof __RELAY_VERSION__ === "string" ? __RELAY_VERSION__ : "dev";

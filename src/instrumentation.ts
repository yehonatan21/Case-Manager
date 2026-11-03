/** Runs once when the server starts: refuse to boot in production with insecure defaults. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionConfig } = await import("./lib/env");
    assertProductionConfig();
  }
}

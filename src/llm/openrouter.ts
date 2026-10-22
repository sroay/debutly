/** Is this OpenRouter's API? By host, so https://evil.test/openrouter.ai/ is not. */
export function isOpenRouter(url: string | undefined): boolean {
  try {
    const host = new URL(url ?? "").hostname.toLowerCase();
    return host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  } catch {
    return false;
  }
}

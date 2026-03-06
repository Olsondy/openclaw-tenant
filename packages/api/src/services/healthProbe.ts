/**
 * HTTP health probe: GET http://host:port/healthz
 * OpenClaw gateway exposes this endpoint without authentication.
 */
async function probeHealth(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://${host}:${port}/healthz`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Batch probe multiple licenses via /healthz.
 * Input: array of { id, host, port }.
 * Output: Record<id, boolean>
 */
export async function batchProbe(
  targets: Array<{ id: number; host: string; port: number }>,
): Promise<Record<number, boolean>> {
  const results = await Promise.all(
    targets.map(async (t) => ({
      id: t.id,
      online: await probeHealth(t.host, t.port),
    })),
  );
  return Object.fromEntries(results.map((r) => [r.id, r.online]));
}

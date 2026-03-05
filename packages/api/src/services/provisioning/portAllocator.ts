import type { Database } from "bun:sqlite";

export interface PortPair {
  gatewayPort: number;
  bridgePort: number;
}

export function allocatePortPair(
  db: Database,
  gatewayStart: number,
  gatewayEnd: number,
  bridgeStart: number,
  bridgeEnd: number,
): PortPair {
  const usedGateway = new Set(
    db
      .query<{ gateway_port: number }, []>(
        "SELECT gateway_port FROM licenses WHERE gateway_port IS NOT NULL",
      )
      .all()
      .map((r) => r.gateway_port),
  );

  const usedBridge = new Set(
    db
      .query<{ bridge_port: number }, []>(
        "SELECT bridge_port FROM licenses WHERE bridge_port IS NOT NULL",
      )
      .all()
      .map((r) => r.bridge_port),
  );

  let gatewayPort: number | null = null;
  for (let p = gatewayStart; p <= gatewayEnd; p++) {
    if (!usedGateway.has(p)) {
      gatewayPort = p;
      break;
    }
  }

  let bridgePort: number | null = null;
  for (let p = bridgeStart; p <= bridgeEnd; p++) {
    if (!usedBridge.has(p)) {
      bridgePort = p;
      break;
    }
  }

  if (gatewayPort === null || bridgePort === null) {
    throw new Error("NO_AVAILABLE_PORT");
  }

  return { gatewayPort, bridgePort };
}

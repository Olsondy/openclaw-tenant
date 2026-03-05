const BASE = "/api";

function getToken(): string | null {
  return localStorage.getItem("jwt");
}

export function saveToken(token: string): void {
  localStorage.setItem("jwt", token);
}

export function clearToken(): void {
  localStorage.removeItem("jwt");
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const data = (await res.json()) as { error?: string } & T;
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
  return data;
}

export interface License {
  id: number;
  license_key: string;
  hwid: string | null;
  device_name: string | null;
  agent_id: string | null;
  status: "unbound" | "active" | "revoked";
  expiry_date: string | null;
  created_at: string;
  bound_at: string | null;
  // Provision fields
  owner_tag: string | null;
  compose_project: string | null;
  container_id: string | null;
  container_name: string | null;
  gateway_port: number | null;
  bridge_port: number | null;
  gateway_url: string;
  webui_url: string | null;
  provision_status: "pending" | "running" | "ready" | "failed" | null;
  provision_error: string | null;
  provision_started_at: string | null;
  provision_completed_at: string | null;
  nginx_host: string | null;
  // Token cache fields
  auth_token: string | null;
  token_expires_at: string | null;
  token_ttl_days: number | null;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ success: boolean; data: { token: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  getLicenses: () => request<{ success: boolean; data: License[] }>("/licenses"),

  generateLicense: (opts: {
    ownerTag?: string;
    expiryDate?: string;
    tokenTtlDays?: number;
    hostIp?: string;
    baseDomain?: string;
  }) =>
    request<{ success: boolean; data: License }>("/licenses", {
      method: "POST",
      body: JSON.stringify(opts),
    }),

  revokeLicense: (id: number) =>
    request<{ success: boolean; data: License }>(`/licenses/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "revoked" }),
    }),
};

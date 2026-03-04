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
  if (token) headers["Authorization"] = `Bearer ${token}`;

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
}

export const api = {
  login: (username: string, password: string) =>
    request<{ success: boolean; data: { token: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  getLicenses: () =>
    request<{ success: boolean; data: License[] }>("/licenses"),

  generateLicense: () =>
    request<{ success: boolean; data: License }>("/licenses", { method: "POST" }),

  revokeLicense: (id: number) =>
    request<{ success: boolean; data: License }>(`/licenses/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "revoked" }),
    }),
};

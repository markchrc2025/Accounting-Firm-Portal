/** Minimal API client for the health check. Expanded in later phases. */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  shared: {
    vatClasses: string[];
    integrationScopes: string[];
  };
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE_URL}/health`);
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}

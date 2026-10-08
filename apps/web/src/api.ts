export class ApiError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } }
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { credentials: 'include', ...init, headers });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new ApiError(body.code ?? 'REQUEST_FAILED', body.detail ?? 'Please try again.', response.status); }
  const type = response.headers.get('content-type') ?? ''; return (type.includes('application/json') || type.includes('problem+json')) ? response.json() : response.text() as T;
}

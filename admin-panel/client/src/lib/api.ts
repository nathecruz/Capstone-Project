export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

/** Lets the auth provider react when any request finds the session expired. */
export function onUnauthorized(listener: Listener) {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    signal: options.signal,
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'habitai-admin',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/login')) unauthorizedListeners.forEach((listener) => listener());
    const message = (payload as { message?: string } | null)?.message
      ?? (response.status >= 500 ? 'The server could not complete the request.' : `Request failed (${response.status}).`);
    throw new ApiError(response.status, message);
  }
  return payload as T;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });

/** Downloads a CSV (or any file) from an authenticated GET endpoint. */
export async function download(path: string, fallbackName: string) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'habitai-admin' } });
  if (!response.ok) throw new ApiError(response.status, 'The export could not be generated.');
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

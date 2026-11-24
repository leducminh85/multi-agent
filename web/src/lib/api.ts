const TOKEN_KEY = 'mao.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Opts = { method?: string; body?: unknown; confirm?: boolean; form?: FormData };

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.confirm) headers['X-Confirm-Action'] = 'true';
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    const detail = data?.details && Array.isArray(data.details) ? `: ${data.details.map((d: any) => `${d.path?.join('.')} ${d.message}`).join('; ')}` : '';
    throw new ApiError(res.status, `${data?.error ?? res.statusText}${detail}`, data?.code, data?.details);
  }
  return data as T;
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: unknown, confirm = false) => api<T>(path, { method: 'POST', body: body ?? {}, confirm });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE', confirm: true });

export async function uploadFiles(files: File[], meta: { scope?: string; projectId?: string; agentId?: string } = {}) {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  for (const [k, v] of Object.entries(meta)) if (v) form.append(k, v);
  return api<import('./types').StoredFile[]>('/files', { method: 'POST', form });
}

/** URL for downloads opened in a new tab (token passed as query for GET only). */
export const downloadUrl = (path: string) => `/api${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken() ?? '')}`;

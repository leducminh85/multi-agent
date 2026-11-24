import crypto from 'node:crypto';

export const newId = (prefix = ''): string =>
  `${prefix}${prefix ? '_' : ''}${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

export const nowIso = (): string => new Date().toISOString();

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`, 'not_found');
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'bad_request', details);

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Mask a secret leaving only the last 4 characters visible. */
export function maskSecret(value: string): string {
  if (!value) return '';
  const tail = value.slice(-4);
  return `••••${tail}`;
}

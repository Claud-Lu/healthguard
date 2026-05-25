import { messageForErrorCode, type Locale } from './i18n';

const apiBase = (import.meta.env.VITE_HEALTHGUARD_API_BASE || '/api').replace(/\/$/, '');

export function apiUrl(path: string): string {
  return `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}

export async function requestJson<T>(url: string, init?: RequestInit, token?: string): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers
    }
  });

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    throw new ApiError(payload.message || `Request failed: ${response.status}`, payload.code);
  }

  return response.json() as Promise<T>;
}

async function readErrorPayload(response: Response): Promise<{ code?: string; message?: string }> {
  try {
    const payload = (await response.json()) as { code?: unknown; message?: unknown };
    return {
      code: typeof payload.code === 'string' ? payload.code : undefined,
      message: typeof payload.message === 'string' ? payload.message : undefined
    };
  } catch {
    return {};
  }
}

export function friendlyErrorMessage(error: unknown, locale: Locale): string {
  if (error instanceof ApiError) {
    return messageForErrorCode(error.code, locale);
  }
  return messageForErrorCode(undefined, locale);
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

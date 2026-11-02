const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; requestId?: string };

let accessToken: string | null = null;
let refreshRequest: Promise<boolean> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshRequest) {
    refreshRequest = (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        if (!response.ok) {
          accessToken = null;
          return false;
        }
        const result = (await response.json()) as { accessToken?: string };
        if (!result.accessToken) {
          accessToken = null;
          return false;
        }
        accessToken = result.accessToken;
        return true;
      } catch {
        accessToken = null;
        return false;
      } finally {
        refreshRequest = null;
      }
    })();
  }
  return refreshRequest;
}

async function send<T>(path: string, options: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {};
  if (Array.isArray(options.headers)) {
    for (const [name, value] of options.headers) headers[name] = value;
  } else if (
    typeof Headers !== 'undefined' &&
    options.headers instanceof Headers
  ) {
    options.headers.forEach((value, name) => { headers[name] = value; });
  } else if (options.headers) {
    Object.assign(headers, options.headers);
  }
  if (
    options.body !== undefined &&
    !Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')
  ) {
    headers['Content-Type'] = 'application/json';
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(`${API_BASE}/api/v1${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  try {
    let response = await send<T>(path, options);
    const isAuthRequest =
      path.startsWith('/auth/login') ||
      path.startsWith('/auth/refresh') ||
      path.startsWith('/platform/admin');
    if (response.status === 401 && !isAuthRequest && await refreshAccessToken()) {
      response = await send<T>(path, options);
    }

    if (response.ok) {
      if (response.status === 204) return { ok: true, data: undefined as T };
      return { ok: true, data: (await response.json()) as T };
    }

    const body = await response.json().catch(() => ({})) as {
      message?: string | string[];
      requestId?: string;
    };
    return {
      ok: false,
      status: response.status,
      message: Array.isArray(body.message)
        ? body.message.join(', ')
        : body.message ?? response.statusText,
      requestId: body.requestId,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : 'Network request failed',
    };
  }
}

export async function apiUpload<T>(
  path: string,
  formData: FormData,
): Promise<ApiResponse<T>> {
  try {
    const sendUpload = () => fetch(`${API_BASE}/api/v1${path}`, {
      method: 'POST',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      body: formData,
      credentials: 'include',
    });
    let response = await sendUpload();
    const isAuthRequest = path.startsWith('/auth/login')
      || path.startsWith('/auth/refresh')
      || path.startsWith('/platform/admin');
    if (response.status === 401 && !isAuthRequest && await refreshAccessToken()) {
      response = await sendUpload();
    }

    if (response.ok) {
      return { ok: true, data: (await response.json()) as T };
    }
    const body = await response.json().catch(() => ({})) as {
      message?: string | string[];
      requestId?: string;
    };
    return {
      ok: false,
      status: response.status,
      message: Array.isArray(body.message)
        ? body.message.join(', ')
        : body.message ?? response.statusText,
      requestId: body.requestId,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : 'File upload failed',
    };
  }
}

export async function apiDownload(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<Blob>> {
  try {
    let response = await send<Blob>(path, options);
    const isAuthRequest =
      path.startsWith('/auth/login') ||
      path.startsWith('/auth/refresh') ||
      path.startsWith('/platform/admin');
    if (response.status === 401 && !isAuthRequest && await refreshAccessToken()) {
      response = await send<Blob>(path, options);
    }

    if (response.ok) return { ok: true, data: await response.blob() };
    const body = await response.json().catch(() => ({})) as {
      message?: string | string[];
      requestId?: string;
    };
    return {
      ok: false,
      status: response.status,
      message: Array.isArray(body.message)
        ? body.message.join(', ')
        : body.message ?? response.statusText,
      requestId: body.requestId,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : 'Network request failed',
    };
  }
}

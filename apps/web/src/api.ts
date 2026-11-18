/**
 * Small client for the ERP API. Keeps the access token in memory and the refresh token in
 * localStorage, refreshes once on 401, and sends an Idempotency-Key on confirms (NFR-REL-02).
 */
const REFRESH_KEY = 'erp.refresh';

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(typeof body?.message === 'string' ? body.message : `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

export interface Me {
  id: string;
  name: string;
  role: 'OWNER' | 'SALESMAN' | 'STOREKEEPER' | 'ACCOUNTANT';
  shopId: string;
}

let access: string | null = null;
let onLogout: () => void = () => {};
let refreshing: Promise<boolean> | null = null;

function readRefresh(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}
function writeRefresh(t: string | null) {
  try {
    if (t) localStorage.setItem(REFRESH_KEY, t);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* private mode: session only */
  }
}

export function setLogoutHandler(f: () => void) {
  onLogout = f;
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (access) headers.set('authorization', `Bearer ${access}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(`/api${path}`, { ...init, headers });
}

async function refresh(): Promise<boolean> {
  const rt = readRefresh();
  if (!rt) return false;
  refreshing ??= (async () => {
    const res = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) });
    if (!res.ok) {
      writeRefresh(null);
      return false;
    }
    const j = await res.json();
    access = j.accessToken;
    writeRefresh(j.refreshToken);
    return true;
  })().finally(() => (refreshing = null));
  return refreshing;
}

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let res = await raw(path, init);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refresh()) res = await raw(path, init);
    else onLogout();
  }
  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw new ApiError(res.status, body);
  }
  return res;
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await request(path, json === undefined ? rest : { ...rest, body: JSON.stringify(json) });
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, json?: unknown, headers?: Record<string, string>) => api<T>(path, { method: 'POST', json: json ?? {}, headers });
export const put = <T = any>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const patch = <T = any>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });

export async function login(loginId: string, password: string): Promise<Me> {
  const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: loginId, password }) });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, j);
  access = j.accessToken;
  writeRefresh(j.refreshToken);
  return j.user;
}

/** On app start: use the saved refresh token to sign in silently. */
export async function resume(): Promise<Me | null> {
  if (!(await refresh())) return null;
  const me = await get<{ userId: string; shopId: string; role: Me['role'] }>('/auth/me');
  return { id: me.userId, name: '', role: me.role, shopId: me.shopId };
}

export async function logout(): Promise<void> {
  const rt = readRefresh();
  writeRefresh(null);
  access = null;
  if (rt) await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) }).catch(() => {});
}

/** Photos and receipts need the token, so they are fetched and shown as blob URLs. */
export async function blobUrl(path: string): Promise<string> {
  const res = await request(path);
  return URL.createObjectURL(await res.blob());
}

export async function text(path: string): Promise<string> {
  return (await request(path)).text();
}

export async function download(path: string, filename: string): Promise<void> {
  const res = await request(path);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

/** multipart upload of one file (opening-stock import) */
export async function uploadFile<T = any>(path: string, field: string, file: File): Promise<T> {
  const form = new FormData();
  form.append(field, file, file.name);
  return (await request(path, { method: 'POST', body: form })).json() as Promise<T>;
}

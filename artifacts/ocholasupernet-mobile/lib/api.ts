import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type AdminProfile = {
  id: number;
  name: string;
  username: string;
  role?: string;
  subdomain?: string;
  area?: string;
  currency?: string;
};

export type AdminSession = {
  token: string;
  admin: AdminProfile;
};

export type DashboardStats = {
  customerCount?: number;
  activePlans?: number;
  revenueMonth?: number;
  vouchersLeft?: number;
  onlineRouters?: number;
  totalRouters?: number;
  activeSessions?: number;
};

export type Customer = {
  id: number;
  name?: string | null;
  username?: string | null;
  phone?: string | null;
  type?: string | null;
  status?: string | null;
  planName?: string | null;
  expiresAt?: string | null;
  createdAt?: string;
  created_at?: string;
};

export type Router = {
  id: number;
  name: string;
  ipAddress?: string | null;
  host?: string | null;
  model?: string | null;
  location?: string | null;
  status?: string | null;
  uptime?: string | null;
  last_seen?: string | null;
};

export type Transaction = {
  id: number;
  amount: number;
  method?: string;
  payment_method?: string;
  status?: string;
  createdAt?: string;
  created_at?: string;
  customerName?: string;
  reference?: string;
};

const SESSION_KEY = 'ocholasupernet.native.admin.session';
const configuredOrigin = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
export const API_ORIGIN = (configuredOrigin || 'https://isplatty.org').replace(/\/+$/, '');

export class SessionRejectedError extends Error {
  constructor() {
    super('Your admin session has expired or was rejected. Sign in again.');
    this.name = 'SessionRejectedError';
  }
}

async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function storageSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function storageDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function loadSession(): Promise<AdminSession | null> {
  const raw = await storageGet(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed.token || !parsed.admin?.id || !parsed.admin.username) return null;
    return parsed;
  } catch {
    await storageDelete(SESSION_KEY);
    return null;
  }
}

export async function saveSession(session: AdminSession): Promise<void> {
  await storageSet(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await storageDelete(SESSION_KEY);
}

function apiUrl(path: string): string {
  return `${API_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

async function parseResponse<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.status === 401 || response.status === 403) {
    throw new SessionRejectedError();
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export async function apiFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(apiUrl(path), { ...init, headers });
  return parseResponse<T>(response);
}

export async function loginAdmin(username: string, password: string): Promise<AdminSession> {
  const response = await fetch(apiUrl('/api/auth/admin/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: username.trim(), password }),
  });
  let body: {
    ok?: boolean;
    token?: string;
    role?: string;
    name?: string;
    error?: string;
    admin?: AdminProfile;
    requiresPasswordSetup?: boolean;
  } = {};
  try {
    body = await response.json();
  } catch {
    // Keep the generic error below for non-JSON upstream responses.
  }

  if (!response.ok || !body.ok || !body.token) {
    throw new Error(body.error || 'Could not create a secure admin session.');
  }
  if (body.requiresPasswordSetup) {
    throw new Error('Password setup is required. Finish setup in the web admin before using the native app.');
  }

  const admin = body.admin ?? {
    id: 0,
    name: body.name || username.trim(),
    username: username.trim(),
    role: body.role,
  };
  if (!admin.id || !admin.username) {
    throw new Error('The server returned an incomplete admin profile.');
  }
  return { token: body.token, admin };
}

export async function verifySession(token: string): Promise<AdminProfile> {
  const body = await apiFetch<{ ok?: boolean; type?: string; user?: AdminProfile }>('/api/auth/me', token);
  if (!body.user || body.type !== 'admin') throw new SessionRejectedError();
  return body.user;
}

export async function fetchDashboardData(session: AdminSession): Promise<{
  stats: DashboardStats | null;
  customers: Customer[];
  routers: Router[];
  transactions: Transaction[];
}> {
  const id = session.admin.id;
  const results = await Promise.allSettled([
    apiFetch<DashboardStats>(`/api/stats/isp/${id}`, session.token),
    apiFetch<Customer[]>(`/api/customers?ispId=${id}`, session.token),
    apiFetch<Router[]>(`/api/routers?ispId=${id}`, session.token),
    apiFetch<Transaction[]>(`/api/transactions?ispId=${id}`, session.token),
  ]);

  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (rejected?.reason instanceof SessionRejectedError) throw rejected.reason;

  return {
    stats: results[0].status === 'fulfilled' ? results[0].value : null,
    customers: results[1].status === 'fulfilled' ? results[1].value : [],
    routers: results[2].status === 'fulfilled' ? results[2].value : [],
    transactions: results[3].status === 'fulfilled' ? results[3].value : [],
  };
}
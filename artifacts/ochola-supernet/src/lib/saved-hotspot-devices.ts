export interface SavedHotspotDevice {
  name: string;
  macAddress: string;
}

export interface SavedHotspotDeviceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MAX_SAVED_DEVICES = 20;

export function hotspotSavedDevicesStorageKey(
  host: string,
  adminId: number | null,
  routerId: number | null,
  portId: number | null,
): string {
  return [
    "ochola_hotspot_devices_v1",
    host || "portal",
    adminId ? String(adminId) : "tenant",
    routerId ? String(routerId) : "router",
    portId ? String(portId) : "port",
  ].map(value => encodeURIComponent(value)).join(":");
}

function normalizeMacAddress(value: unknown): string {
  const trimmed = String(value ?? "").trim();
  if (!/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(trimmed) && !/^[0-9a-f]{12}$/i.test(trimmed)) {
    return "";
  }
  return trimmed.replace(/[:-]/g, "").toUpperCase().match(/.{2}/g)?.join(":") ?? "";
}

function normalizeDevice(value: unknown): SavedHotspotDevice | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const macAddress = normalizeMacAddress(row.macAddress);
  const name = typeof row.name === "string" ? row.name.trim().replace(/\s+/g, " ").slice(0, 64) : "";
  return macAddress && name ? { name, macAddress } : null;
}

function getBrowserStorage(): SavedHotspotDeviceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readSavedHotspotDevices(
  storageKey: string,
  storage: SavedHotspotDeviceStorage | null = getBrowserStorage(),
): SavedHotspotDevice[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(storageKey) ?? "null");
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const devices: SavedHotspotDevice[] = [];
    for (const row of parsed) {
      const device = normalizeDevice(row);
      if (!device || seen.has(device.macAddress)) continue;
      seen.add(device.macAddress);
      devices.push(device);
      if (devices.length >= MAX_SAVED_DEVICES) break;
    }
    return devices;
  } catch {
    return [];
  }
}

export function saveHotspotDevice(
  storageKey: string,
  device: SavedHotspotDevice,
  storage: SavedHotspotDeviceStorage | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  const normalized = normalizeDevice(device);
  if (!normalized) return false;

  try {
    const devices = readSavedHotspotDevices(storageKey, storage)
      .filter(existing => existing.macAddress !== normalized.macAddress);
    storage.setItem(storageKey, JSON.stringify([normalized, ...devices].slice(0, MAX_SAVED_DEVICES)));
    return true;
  } catch {
    return false;
  }
}

export function renameHotspotDevice(
  storageKey: string,
  macAddress: string,
  name: string,
  storage: SavedHotspotDeviceStorage | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  const normalizedMac = normalizeMacAddress(macAddress);
  const normalized = normalizeDevice({ macAddress: normalizedMac, name });
  if (!normalizedMac || !normalized) return false;

  try {
    const devices = readSavedHotspotDevices(storageKey, storage);
    const index = devices.findIndex(device => device.macAddress === normalizedMac);
    if (index < 0) return false;
    devices[index] = normalized;
    storage.setItem(storageKey, JSON.stringify(devices));
    return true;
  } catch {
    return false;
  }
}

export function forgetHotspotDevice(
  storageKey: string,
  macAddress: string,
  storage: SavedHotspotDeviceStorage | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  const normalizedMac = normalizeMacAddress(macAddress);
  if (!normalizedMac) return false;

  try {
    const devices = readSavedHotspotDevices(storageKey, storage)
      .filter(device => device.macAddress !== normalizedMac);
    storage.setItem(storageKey, JSON.stringify(devices));
    return true;
  } catch {
    return false;
  }
}
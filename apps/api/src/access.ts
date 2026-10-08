import type { Config } from './config.js';

type Geo = { lat: number; lng: number; accuracyM: number };
export type AccessSettings = { mode: 'STRICT' | 'STANDARD' | 'QR_ONLY' | 'OFF'; ip: { enabled: boolean; allowlist: string[] }; geo: { enabled: boolean; lat: number; lng: number; radiusM: number; maxAccuracyM: number } };

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (n: number) => n * Math.PI / 180; const r = 6_371_000;
  const dLat = toRad(bLat - aLat); const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function ipv4AsInteger(ip: string) {
  const parts = ip.replace(/^::ffff:/, '').split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
}

export function ipMatchesCidrs(ip: string, allowlist: string[]) {
  const ipValue = ipv4AsInteger(ip);
  return allowlist.some((entry) => {
    if (entry === '*') return true;
    if (entry === ip) return true;
    const [network, lengthText] = entry.split('/'); const length = Number(lengthText);
    const networkValue = ipv4AsInteger(network);
    if (ipValue === null || networkValue === null || !Number.isInteger(length) || length < 0 || length > 32) return false;
    const mask = length === 0 ? 0 : (0xffffffff << (32 - length)) >>> 0;
    return (ipValue & mask) === (networkValue & mask);
  });
}

export function evaluateAccess(config: Config, settings: AccessSettings, input: { presence: boolean; ip: string; geo?: Geo }) {
  const ipOk = settings.ip.enabled ? ipMatchesCidrs(input.ip, settings.ip.allowlist) : null;
  const distanceM = input.geo ? haversineMeters(input.geo.lat, input.geo.lng, settings.geo.lat, settings.geo.lng) : null;
  const geoOk = settings.geo.enabled ? Boolean(input.geo && input.geo.accuracyM <= settings.geo.maxAccuracyM && (distanceM ?? Infinity) - input.geo.accuracyM <= settings.geo.radiusM) : null;
  const networkEnabled = ipOk !== null || geoOk !== null; const networkOk = ipOk === true || geoOk === true;
  let allowed = false;
  if (settings.mode === 'OFF') allowed = config.NODE_ENV !== 'production';
  if (settings.mode === 'QR_ONLY') allowed = input.presence;
  if (settings.mode === 'STANDARD') allowed = networkEnabled && networkOk;
  if (settings.mode === 'STRICT') allowed = input.presence && networkEnabled && networkOk;
  const reason = allowed ? undefined : (!input.presence && settings.mode !== 'STANDARD' ? 'PRESENCE_REQUIRED' : (settings.geo.enabled && !input.geo && ipOk !== true ? 'LOCATION_NEEDED' : 'OUTSIDE_VENUE'));
  return { allowed, reason, signals: { mode: settings.mode, presence_ok: input.presence, ip_ok: ipOk, geo_ok: geoOk, distance_m: distanceM, accuracy_m: input.geo?.accuracyM ?? null } };
}

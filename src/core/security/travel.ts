import geoip from 'geoip-lite';
import { logger } from '@core/logger/index';

export interface TravelCalculation {
  lastLoginIp: string;
  lastLoginCountry: string;
  lastLoginAt: Date;
  newLoginIp: string;
  newLoginCountry: string;
  newLoginAt: Date;
}

export interface ImpossibleTravelResult {
  suspicious: boolean;
  velocityKmh: number;
  distanceKm: number;
  durationHours: number;
}

/**
 * Resolves an IP address to its ISO-3166-1 alpha-2 country code using geoip-lite.
 * Returns null if the IP cannot be resolved (e.g. local / loopback IPs).
 */
export function resolveCountry(ip: string): string | null {
  // geoip-lite returns null for local/loopback IPs
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    return null;
  }
  const geo = geoip.lookup(ip);
  return geo?.country || null;
}

/**
 * Resolves an IP address to its geographical coordinates [latitude, longitude].
 * Returns null if coordinates cannot be resolved.
 */
export function resolveCoordinates(ip: string): [number, number] | null {
  const geo = geoip.lookup(ip);
  return geo ? geo.ll : null;
}

/**
 * Calculates the great-circle distance between two points on the Earth's surface
 * using the Haversine formula.
 */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Checks if a login attempt represents "impossible travel" based on geographic distance,
 * time elapsed, and country boundaries.
 *
 * Velocity threshold: 800 km/h (approx. 500 mph)
 * Trigger condition: velocity > 800 km/h AND country boundary crossed.
 */
export function detectImpossibleTravel(params: TravelCalculation): ImpossibleTravelResult {
  const { lastLoginIp, lastLoginCountry, lastLoginAt, newLoginIp, newLoginCountry, newLoginAt } =
    params;

  const durationMs = newLoginAt.getTime() - lastLoginAt.getTime();
  // Safe fallback if logins happen simultaneously or clock skew issues
  const durationHours = Math.max(durationMs, 1000) / 1000 / 3600;

  // Resolve coordinates
  const lastCoords = resolveCoordinates(lastLoginIp);
  const newCoords = resolveCoordinates(newLoginIp);

  if (!lastCoords || !newCoords) {
    logger.debug(
      { lastLoginIp, newLoginIp },
      'Coordinates could not be resolved; skipping impossible travel detection'
    );
    return { suspicious: false, velocityKmh: 0, distanceKm: 0, durationHours };
  }

  const [lastLat, lastLon] = lastCoords;
  const [newLat, newLon] = newCoords;

  const distanceKm = haversineKm(lastLat, lastLon, newLat, newLon);
  const velocityKmh = distanceKm / durationHours;

  // Suspicious if velocity > 800 km/h AND country boundary is crossed
  const countryCrossed = lastLoginCountry !== newLoginCountry;
  const suspicious = velocityKmh > 800 && countryCrossed;

  if (suspicious) {
    logger.warn(
      {
        lastLoginIp,
        lastLoginCountry,
        lastLoginAt,
        newLoginIp,
        newLoginCountry,
        newLoginAt,
        distanceKm,
        durationHours,
        velocityKmh,
      },
      '🚨 Active threat detected: Impossible travel'
    );
  }

  return {
    suspicious,
    velocityKmh,
    distanceKm,
    durationHours,
  };
}

import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  detectImpossibleTravel,
  resolveCountry,
} from '@core/security/travel';

describe('haversineKm', () => {
  it('correctly calculates distance between London and New York', () => {
    // Coordinates: London (51.5074, -0.1278), New York (40.7128, -74.0060)
    const distance = haversineKm(51.5074, -0.1278, 40.7128, -74.0060);
    // London to NY is roughly 5570 km
    expect(distance).toBeGreaterThan(5500);
    expect(distance).toBeLessThan(5600);
  });

  it('returns 0 for identical coordinates', () => {
    const distance = haversineKm(45.0, 90.0, 45.0, 90.0);
    expect(distance).toBe(0);
  });
});

describe('resolveCountry', () => {
  it('returns null for loopback IP addresses', () => {
    expect(resolveCountry('127.0.0.1')).toBeNull();
    expect(resolveCountry('::1')).toBeNull();
  });

  it('resolves known public IP addresses', () => {
    // 8.8.8.8 resolves to US
    expect(resolveCountry('8.8.8.8')).toBe('US');
  });
});

describe('detectImpossibleTravel', () => {
  it('flags logins as suspicious when velocity is > 800 km/h and country changes', () => {
    const lastLoginAt = new Date();
    // 30 mins later
    const newLoginAt = new Date(lastLoginAt.getTime() + 30 * 60 * 1000);

    const result = detectImpossibleTravel({
      lastLoginIp: '8.8.8.8', // US
      lastLoginCountry: 'US',
      lastLoginAt,
      newLoginIp: '82.165.196.17', // Germany IP
      newLoginCountry: 'DE',
      newLoginAt,
    });

    // Distance US to DE is > 6000km, traversed in 30 mins = 12000 km/h
    expect(result.suspicious).toBe(true);
    expect(result.velocityKmh).toBeGreaterThan(800);
  });

  it('does NOT flag logins if country has not changed', () => {
    const lastLoginAt = new Date();
    // 1 min later
    const newLoginAt = new Date(lastLoginAt.getTime() + 1 * 60 * 1000);

    const result = detectImpossibleTravel({
      lastLoginIp: '8.8.8.8', // US
      lastLoginCountry: 'US',
      lastLoginAt,
      newLoginIp: '8.8.4.4', // US
      newLoginCountry: 'US',
      newLoginAt,
    });

    expect(result.suspicious).toBe(false);
  });

  it('does NOT flag logins if velocity is <= 800 km/h', () => {
    const lastLoginAt = new Date();
    // 12 hours later
    const newLoginAt = new Date(lastLoginAt.getTime() + 12 * 3600 * 1000);

    const result = detectImpossibleTravel({
      lastLoginIp: '8.8.8.8', // US
      lastLoginCountry: 'US',
      lastLoginAt,
      newLoginIp: '82.165.196.17', // Germany
      newLoginCountry: 'DE',
      newLoginAt,
    });

    // ~6000 km in 12 hours is ~500 km/h
    expect(result.suspicious).toBe(false);
    expect(result.velocityKmh).toBeLessThan(800);
  });
});

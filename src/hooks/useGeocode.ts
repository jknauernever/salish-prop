import { useState, useCallback } from 'react';
import type { GeocodingResult } from '../types';
import { geocodeAddress } from '../services/geocode';

export function useGeocode() {
  const [result, setResult] = useState<GeocodingResult | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const geocode = useCallback(async (address: string) => {
    setIsGeocoding(true);
    setError(null);
    try {
      const res = await geocodeAddress(address);
      setResult(res);
      return res;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Geocoding failed';
      setError(message);
      return null;
    } finally {
      setIsGeocoding(false);
    }
  }, []);

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, isGeocoding, error, geocode, clear };
}

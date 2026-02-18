import type { GeocodingResult } from '../types';

let geocoder: google.maps.Geocoder | null = null;

function getGeocoder(): google.maps.Geocoder {
  if (!geocoder) {
    geocoder = new google.maps.Geocoder();
  }
  return geocoder;
}

export async function geocodeAddress(address: string): Promise<GeocodingResult> {
  const gc = getGeocoder();
  const { results } = await gc.geocode({ address });

  if (!results || results.length === 0) {
    throw new Error('No results found for this address');
  }

  const result = results[0];
  const location = result.geometry.location;

  return {
    lat: location.lat(),
    lng: location.lng(),
    formattedAddress: result.formatted_address,
  };
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const gc = getGeocoder();
  try {
    const { results } = await gc.geocode({ location: { lat, lng } });
    if (!results || results.length === 0) return null;
    // Prefer a street-address type result
    const street = results.find(r => r.types.includes('street_address'));
    return (street || results[0]).formatted_address;
  } catch {
    return null;
  }
}

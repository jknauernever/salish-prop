import { useEffect, useRef, useState } from 'react';
import { useMap } from '../../hooks/useMap';
import { LoadingSpinner } from '../common/LoadingState';

interface AddressSearchProps {
  onPlaceSelected: (result: { lat: number; lng: number; formattedAddress: string }) => void;
  isSearching: boolean;
}

// San Juan County bounds for biasing
const SJC_BOUNDS = {
  north: 48.85,
  south: 48.40,
  east: -122.75,
  west: -123.25,
};

export function AddressSearch({ onPlaceSelected, isSearching }: AddressSearchProps) {
  const { map } = useMap();
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [address, setAddress] = useState('');
  const onPlaceSelectedRef = useRef(onPlaceSelected);
  onPlaceSelectedRef.current = onPlaceSelected;

  useEffect(() => {
    if (!map || !inputRef.current || autocompleteRef.current) return;

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      bounds: new google.maps.LatLngBounds(
        { lat: SJC_BOUNDS.south, lng: SJC_BOUNDS.west },
        { lat: SJC_BOUNDS.north, lng: SJC_BOUNDS.east },
      ),
      componentRestrictions: { country: 'us' },
      types: ['address'],
      fields: ['formatted_address', 'geometry.location'],
    });

    autocompleteRef.current = autocomplete;

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place.geometry?.location) return;

      const result = {
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
        formattedAddress: place.formatted_address || '',
      };

      setAddress(result.formattedAddress);
      onPlaceSelectedRef.current(result);
    });
  }, [map]);

  return (
    <div className="flex items-center gap-2 w-full">
      <div className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search a San Juan County address..."
          className="w-full px-3 py-1.5 rounded-md border border-white/20 bg-white/10 text-white text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-deep-teal/50 focus:bg-white/15"
        />
      </div>
      {isSearching && <LoadingSpinner size="sm" />}
    </div>
  );
}

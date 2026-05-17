import { useEffect, useRef } from 'react';
import { importLibrary } from '@googlemaps/js-api-loader';
import { useMap } from '../../hooks/useMap';
import { LoadingSpinner } from '../common/LoadingState';

interface AddressSearchProps {
  onPlaceSelected: (result: { lat: number; lng: number; formattedAddress: string }) => void;
  isSearching: boolean;
}

const SJC_BOUNDS = {
  north: 48.85,
  south: 48.40,
  east: -122.75,
  west: -123.25,
};

export function AddressSearch({ onPlaceSelected, isSearching }: AddressSearchProps) {
  const { map } = useMap();
  const containerRef = useRef<HTMLDivElement>(null);
  const onPlaceSelectedRef = useRef(onPlaceSelected);
  onPlaceSelectedRef.current = onPlaceSelected;

  useEffect(() => {
    if (!map || !containerRef.current) return;

    const container = containerRef.current;
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        await importLibrary('places');
        // Ensure the custom element is registered before constructing it.
        // Earlier attempts hit "Illegal constructor" because js-api-loader v2
        // hadn't finished registering the element when new PlaceAutocompleteElement() ran.
        await customElements.whenDefined('gmp-place-autocomplete');
        if (cancelled) return;

        const el = new google.maps.places.PlaceAutocompleteElement({
          locationBias: new google.maps.LatLngBounds(
            { lat: SJC_BOUNDS.south, lng: SJC_BOUNDS.west },
            { lat: SJC_BOUNDS.north, lng: SJC_BOUNDS.east },
          ),
          includedRegionCodes: ['us'],
          placeholder: 'Search an address...',
        });

        el.style.width = '100%';
        container.appendChild(el);

        const handler: EventListener = async (event) => {
          const place = (event as google.maps.places.PlacePredictionSelectEvent).placePrediction.toPlace();
          await place.fetchFields({ fields: ['formattedAddress', 'location'] });

          const lat = place.location?.lat();
          const lng = place.location?.lng();
          if (typeof lat !== 'number' || typeof lng !== 'number') return;

          onPlaceSelectedRef.current({
            lat,
            lng,
            formattedAddress: place.formattedAddress ?? '',
          });
        };

        el.addEventListener('gmp-select', handler);

        cleanup = () => {
          el.removeEventListener('gmp-select', handler);
          el.remove();
        };
      } catch (err) {
        console.error('Failed to initialize PlaceAutocompleteElement:', err);
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [map]);

  return (
    <div className="flex items-center gap-2 w-full">
      <div ref={containerRef} className="address-search-container relative flex-1" />
      {isSearching && <LoadingSpinner size="sm" />}
    </div>
  );
}

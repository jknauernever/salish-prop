import { useState, useEffect, useCallback } from 'react';
import type { SpatialQueryResult, LayerState } from '../types';
import { queryRadius } from '../services/spatial';

export function useSpatialQuery(layers: LayerState[]) {
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radiusMeters, setRadiusMeters] = useState(402); // ¼ mile
  const [results, setResults] = useState<SpatialQueryResult[]>([]);
  const [homeParcel, setHomeParcel] = useState<GeoJSON.Feature | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);

  const runQuery = useCallback((newCenter: [number, number], newRadius?: number) => {
    setCenter(newCenter);
    if (newRadius != null) setRadiusMeters(newRadius);
  }, []);

  useEffect(() => {
    if (!center) return;

    const loadedLayers = layers.filter(l => l.loaded && l.geojsonData);
    if (loadedLayers.length === 0) return;

    setIsQuerying(true);

    // Run async to avoid blocking UI
    requestAnimationFrame(() => {
      const output = queryRadius({
        center,
        radiusMeters,
        layers: loadedLayers,
      });
      setResults(output.results);
      setHomeParcel(output.homeParcel);
      setIsQuerying(false);
    });
  }, [center, radiusMeters, layers]);

  const updateRadius = useCallback((newRadius: number) => {
    setRadiusMeters(newRadius);
  }, []);

  const totalFeatureCount = results.reduce((sum, r) => sum + r.count, 0);

  return {
    results,
    homeParcel,
    isQuerying,
    totalFeatureCount,
    radiusMeters,
    runQuery,
    updateRadius,
    center,
  };
}

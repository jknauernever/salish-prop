export type LockableControl = 'layers' | 'search';

export type PresetFeatures = {
  propertyClick?: boolean;
};

export type Preset = {
  title: string;
  description?: string;
  layers: string[];
  features: PresetFeatures;
  locked: boolean;
  lockedControls?: LockableControl[];
  initialView?: {
    center: { lat: number; lng: number };
    zoom: number;
  };
  meta: {
    title: string;
    description: string;
    ogImage: string;
    ogUrl: string;
  };
};

export const presets: Record<string, Preset> = {
  'salmon-habitat': {
    title: 'Salmon Habitat',
    description: 'Where juvenile Chinook, chum, and pink salmon are most likely to rear along San Juan Islands shorelines.',
    layers: ['fish-use', 'eelgrass'],
    features: {
      propertyClick: true,
    },
    locked: false,
    initialView: {
      center: { lat: 48.605, lng: -123.0 },
      zoom: 10.8,
    },
    meta: {
      title: 'Salmon Habitat in the San Juan Islands',
      description:
        'Explore which San Juan Islands shorelines are moderate, high and highest priority for rearing juvenile Chinook, chum, and pink salmon.',
      // /og/salmon-habitat.png never existed; the site's own preview image endpoint does
      ogImage: 'https://salishsea.knauernever.com/api/og',
      ogUrl: 'https://salishsea.knauernever.com/view/salmon-habitat',
    },
  },
};

export function getPreset(name: string | undefined): Preset | null {
  if (!name) return null;
  const preset = presets[name];
  if (!preset) {
    console.warn(`Unknown preset: "${name}". Falling back to default map.`);
    return null;
  }
  return preset;
}

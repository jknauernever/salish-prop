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
    description: 'Chinook, chum, and pink salmon shoreline habitat across the San Juan Islands.',
    layers: ['chinook-salmon', 'chum-salmon', 'pink-salmon', 'eelgrass'],
    features: {
      propertyClick: true,
    },
    locked: false,
    initialView: {
      center: { lat: 48.55, lng: -123.0 },
      zoom: 11,
    },
    meta: {
      title: 'Salmon Habitat in the San Juan Islands',
      description:
        'Explore nearshore habitat relevance for Chinook, chum, and pink salmon across the San Juan Islands.',
      ogImage: 'https://salish-sea-propmapper.vercel.app/og/salmon-habitat.png',
      ogUrl: 'https://salish-sea-propmapper.vercel.app/view/salmon-habitat',
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

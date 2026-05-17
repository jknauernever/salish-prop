import { useEffect, useState } from 'react';
import { layerConfigs } from '../config/layers';
import type { LayerConfig } from '../types';

export interface CategoryNode {
  id: string;
  label: string;
  /** Layer ids assigned to this category. A layer can appear in multiple categories. */
  layers: string[];
  children: CategoryNode[];
}

export interface CategoryTree {
  version: number;
  updated_at: string | null;
  tree: CategoryNode[];
}

const FALLBACK_LABELS: Record<string, string> = {
  'friends-data': 'Friends of the San Juans',
  'fish-habitat': 'Fish Habitat',
  ecological: 'Ecological',
  property: 'Property',
  planning: 'Planning & Infrastructure',
  'community-science': 'Community Science',
};

const FALLBACK_ORDER = [
  'friends-data',
  'fish-habitat',
  'ecological',
  'property',
  'planning',
  'community-science',
];

/**
 * Baked-in fallback used while the live fetch is in flight or if it fails.
 * Built from layerConfigs at module load so the fallback assignments always
 * match what the code actually defines.
 */
export const FALLBACK_TREE: CategoryTree = {
  version: 0,
  updated_at: null,
  tree: FALLBACK_ORDER.map((id) => ({
    id,
    label: FALLBACK_LABELS[id] ?? id,
    layers: layerConfigs
      .filter((l) => (l.category as string) === id)
      .map((l) => l.id),
    children: [],
  })),
};

const TREE_URL =
  import.meta.env.VITE_CATEGORY_TREE_URL ??
  'https://storage.googleapis.com/salish-ndvi-tiles/config/category-tree.json';

let cachedTree: CategoryTree | null = null;
let inflight: Promise<CategoryTree> | null = null;

function isValidTree(data: unknown): data is CategoryTree {
  if (!data || typeof data !== 'object') return false;
  const t = data as Partial<CategoryTree>;
  return Array.isArray(t.tree);
}

/**
 * Backfill `layers: []` on any node that's missing it. Lets us read older
 * tree files (from before the layers field existed) without crashing.
 */
function normalizeNode(n: Partial<CategoryNode> & { id: string; label: string }): CategoryNode {
  return {
    id: n.id,
    label: n.label,
    layers: Array.isArray(n.layers) ? n.layers : [],
    children: Array.isArray(n.children) ? n.children.map(normalizeNode) : [],
  };
}

function normalizeTree(t: CategoryTree): CategoryTree {
  return {
    version: t.version,
    updated_at: t.updated_at,
    tree: t.tree.map(normalizeNode),
  };
}

export async function fetchCategoryTree(): Promise<CategoryTree> {
  if (cachedTree) return cachedTree;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(TREE_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!isValidTree(data)) throw new Error('Invalid tree shape');
      const normalized = normalizeTree(data);
      cachedTree = normalized;
      return normalized;
    } catch (err) {
      console.warn('Category tree fetch failed, using baked-in fallback:', err);
      cachedTree = FALLBACK_TREE;
      return FALLBACK_TREE;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function getCachedTree(): CategoryTree {
  return cachedTree ?? FALLBACK_TREE;
}

export function clearCache(): void {
  cachedTree = null;
}

export function findCategoryById(nodes: CategoryNode[], id: string): CategoryNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findCategoryById(n.children, id);
    if (found) return found;
  }
  return null;
}

/** Pre-order list of every category id in the tree. */
export function flattenCategoryIds(nodes: CategoryNode[]): string[] {
  const ids: string[] = [];
  function walk(arr: CategoryNode[]) {
    for (const n of arr) {
      ids.push(n.id);
      walk(n.children);
    }
  }
  walk(nodes);
  return ids;
}

/**
 * Dev-mode sanity check: warn about any layer whose category id is missing from
 * the loaded tree. Compensates for losing the LayerCategory union type.
 */
export function validateLayerCategories(tree: CategoryNode[], layers: LayerConfig[]): void {
  const known = new Set(flattenCategoryIds(tree));
  const missing = new Map<string, string[]>();
  for (const l of layers) {
    if (!known.has(l.category)) {
      const list = missing.get(l.category) ?? [];
      list.push(l.id);
      missing.set(l.category, list);
    }
  }
  if (missing.size > 0) {
    console.warn(
      '[categoryTree] Some layers reference category ids not present in the category tree:',
      Object.fromEntries(missing),
    );
  }
}

/** Set of every layer id assigned anywhere in the tree (deduped). */
export function collectAssignedLayerIds(tree: CategoryNode[]): Set<string> {
  const out = new Set<string>();
  function walk(nodes: CategoryNode[]) {
    for (const n of nodes) {
      for (const l of n.layers) out.add(l);
      walk(n.children);
    }
  }
  walk(tree);
  return out;
}

/** Layer ids that exist in code but are not assigned to any tree node. */
export function findOrphanLayerIds(
  tree: CategoryNode[],
  layers: LayerConfig[],
): string[] {
  const assigned = collectAssignedLayerIds(tree);
  return layers.filter((l) => !assigned.has(l.id)).map((l) => l.id);
}

/** React hook: returns the current tree (cache or fallback) plus a loading flag. */
export function useCategoryTree(): { tree: CategoryTree; loading: boolean } {
  const [tree, setTree] = useState<CategoryTree>(() => cachedTree ?? FALLBACK_TREE);
  const [loading, setLoading] = useState<boolean>(() => cachedTree === null);

  useEffect(() => {
    if (cachedTree) {
      setTree(cachedTree);
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchCategoryTree().then((t) => {
      if (cancelled) return;
      setTree(t);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { tree, loading };
}

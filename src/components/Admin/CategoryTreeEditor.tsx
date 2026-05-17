import { useEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeRendererProps, type TreeApi } from 'react-arborist';
import {
  fetchCategoryTree,
  clearCache,
  type CategoryTree,
} from '../../services/categoryTree';
import { layerConfigs } from '../../config/layers';
import { getAdminToken } from './AuthGate';

interface EditorNode {
  id: string;
  label: string;
  layers: string[];
  children: EditorNode[];
}

const SLUG_RE = /[^a-z0-9-]+/g;

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .trim()
    .replace(SLUG_RE, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64);
  return base || 'category';
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function collectIds(nodes: readonly EditorNode[]): Set<string> {
  const out = new Set<string>();
  function walk(arr: readonly EditorNode[]): void {
    for (const n of arr) {
      out.add(n.id);
      walk(n.children);
    }
  }
  walk(nodes);
  return out;
}

function collectAssignedLayerIds(nodes: readonly EditorNode[]): Set<string> {
  const out = new Set<string>();
  function walk(arr: readonly EditorNode[]): void {
    for (const n of arr) {
      for (const l of n.layers) out.add(l);
      walk(n.children);
    }
  }
  walk(nodes);
  return out;
}

function cloneTree(nodes: readonly EditorNode[]): EditorNode[] {
  return nodes.map(n => ({
    id: n.id,
    label: n.label,
    layers: [...n.layers],
    children: cloneTree(n.children),
  }));
}

function updateNode(
  nodes: readonly EditorNode[],
  id: string,
  fn: (n: EditorNode) => EditorNode,
): EditorNode[] {
  return nodes.map(n => {
    if (n.id === id) return fn(n);
    return { ...n, children: updateNode(n.children, id, fn) };
  });
}

function removeNode(nodes: readonly EditorNode[], id: string): EditorNode[] {
  return nodes
    .filter(n => n.id !== id)
    .map(n => ({ ...n, children: removeNode(n.children, id) }));
}

function addChildTo(
  nodes: readonly EditorNode[],
  parentId: string,
  child: EditorNode,
): EditorNode[] {
  return nodes.map(n => {
    if (n.id === parentId) {
      return { ...n, children: [...n.children, child] };
    }
    return { ...n, children: addChildTo(n.children, parentId, child) };
  });
}

function findNodeById(nodes: readonly EditorNode[], id: string): EditorNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNodeById(n.children, id);
    if (found) return found;
  }
  return null;
}

function moveNodes(
  tree: readonly EditorNode[],
  dragIds: readonly string[],
  parentId: string | null,
  index: number,
): EditorNode[] {
  const dragSet = new Set(dragIds);
  const captured: EditorNode[] = [];

  function extract(arr: readonly EditorNode[]): EditorNode[] {
    const kept: EditorNode[] = [];
    for (const n of arr) {
      if (dragSet.has(n.id)) {
        captured.push({ id: n.id, label: n.label, layers: [...n.layers], children: cloneTree(n.children) });
      } else {
        kept.push({ ...n, children: extract(n.children) });
      }
    }
    return kept;
  }

  const withoutDragged = extract(tree);

  function insert(arr: EditorNode[]): EditorNode[] {
    if (parentId === null) {
      const out = [...arr];
      out.splice(index, 0, ...captured);
      return out;
    }
    return arr.map(n => {
      if (n.id === parentId) {
        const newChildren = [...n.children];
        newChildren.splice(index, 0, ...captured);
        return { ...n, children: newChildren };
      }
      return { ...n, children: insert(n.children) };
    });
  }

  return insert(withoutDragged);
}

function toggleLayerInNode(
  nodes: readonly EditorNode[],
  categoryId: string,
  layerId: string,
): EditorNode[] {
  return updateNode(nodes, categoryId, n => {
    const has = n.layers.includes(layerId);
    return {
      ...n,
      layers: has ? n.layers.filter(id => id !== layerId) : [...n.layers, layerId],
    };
  });
}

interface RowExtra {
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  onRename: (id: string, label: string) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (id: string) => void;
}

function CategoryRow({
  node,
  style,
  dragHandle,
  editingId,
  setEditingId,
  selectedId,
  setSelectedId,
  onRename,
  onAddChild,
  onDelete,
}: NodeRendererProps<EditorNode> & RowExtra) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isEditing = editingId === node.id;
  const isSelected = selectedId === node.id;
  const layerCount = node.data.layers.length;
  const childCount = node.data.children.length;
  const canBeDeleted = childCount === 0 && layerCount === 0;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  function commitEdit() {
    const val = inputRef.current?.value ?? '';
    if (val.trim()) onRename(node.id, val);
    setEditingId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function attemptDelete() {
    if (!canBeDeleted) {
      const reason = childCount > 0
        ? `it has ${childCount} child categor${childCount === 1 ? 'y' : 'ies'} — delete those first`
        : `${layerCount} layer${layerCount === 1 ? '' : 's'} assigned — unassign them first`;
      window.alert(`Cannot delete "${node.data.label}" — ${reason}.`);
      return;
    }
    if (window.confirm(`Delete category "${node.data.label}"?`)) {
      onDelete(node.id);
    }
  }

  return (
    <div
      ref={dragHandle}
      style={style}
      onClick={() => setSelectedId(node.id)}
      className={`flex items-center gap-2 px-2 rounded group cursor-pointer ${
        isSelected ? 'bg-deep-teal/10 ring-1 ring-deep-teal/30' : 'hover:bg-fog-gray/50'
      }`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          node.toggle();
        }}
        className={`w-4 h-4 flex items-center justify-center text-slate-blue/40 hover:text-slate-blue ${
          childCount === 0 ? 'invisible' : ''
        }`}
        tabIndex={-1}
      >
        <svg
          className={`w-3 h-3 transition-transform ${node.isOpen ? 'rotate-90' : ''}`}
          viewBox="0 0 12 12"
          fill="currentColor"
        >
          <path d="M4 2 L9 6 L4 10 Z" />
        </svg>
      </button>

      {isEditing ? (
        <input
          ref={inputRef}
          defaultValue={node.data.label}
          onClick={(e) => e.stopPropagation()}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitEdit();
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
              return;
            }
            // Stop space, arrows, etc. from bubbling up to react-arborist,
            // which would otherwise hijack them for tree-level shortcuts.
            e.stopPropagation();
          }}
          className="flex-1 px-1.5 py-0.5 text-sm border border-deep-teal rounded outline-none bg-white"
        />
      ) : (
        <span
          onDoubleClick={(e) => { e.stopPropagation(); setEditingId(node.id); }}
          className="flex-1 text-sm text-slate-blue truncate"
          title="Double-click to rename"
        >
          {node.data.label}
        </span>
      )}

      {layerCount > 0 && (
        <span
          className="text-[10px] bg-fog-gray-dark/40 text-slate-blue px-1.5 py-0.5 rounded shrink-0"
          title={`${layerCount} layer${layerCount === 1 ? '' : 's'} assigned to this category`}
        >
          {layerCount}
        </span>
      )}

      <span className="text-[10px] text-slate-blue/40 font-mono shrink-0">{node.id}</span>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }}
          className="text-xs px-1.5 py-0.5 text-slate-blue/70 hover:text-slate-blue hover:bg-fog-gray rounded"
          title="Add child category"
        >
          + Child
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); attemptDelete(); }}
          className={`text-xs px-1.5 py-0.5 rounded ${
            canBeDeleted
              ? 'text-red-600 hover:text-red-700 hover:bg-red-50'
              : 'text-slate-blue/30 cursor-not-allowed'
          }`}
          title={canBeDeleted ? 'Delete' : 'Cannot delete: has children or assigned layers'}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

interface AssignmentPanelProps {
  selectedNode: EditorNode | null;
  workingTree: readonly EditorNode[];
  onToggleLayer: (categoryId: string, layerId: string) => void;
}

function LayerAssignmentPanel({ selectedNode, workingTree, onToggleLayer }: AssignmentPanelProps) {
  const [search, setSearch] = useState('');

  if (!selectedNode) {
    return (
      <div className="text-sm text-slate-blue/50 italic">
        Select a category on the left to see and manage its assigned layers.
      </div>
    );
  }

  const assigned = new Set(selectedNode.layers);
  const q = search.trim().toLowerCase();
  const filtered = layerConfigs
    .filter(l => !q || l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const assignedCount = selectedNode.layers.length;

  return (
    <div className="flex flex-col h-full">
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-slate-blue">
          Layers in "{selectedNode.label}"
        </h2>
        <p className="text-xs text-slate-blue/60 mt-0.5">
          {assignedCount} assigned · {layerConfigs.length} available · check to assign, uncheck to remove
        </p>
      </div>

      <input
        type="search"
        placeholder="Search layers…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-2.5 py-1.5 mb-2 text-sm border border-fog-gray-dark/60 rounded outline-none focus:ring-2 focus:ring-deep-teal/30"
      />

      <ul className="flex-1 overflow-y-auto space-y-0.5 border border-fog-gray-dark/30 rounded bg-white p-1">
        {filtered.length === 0 && (
          <li className="text-xs text-slate-blue/40 italic p-2">No layers match "{search}".</li>
        )}
        {filtered.map(layer => {
          const checked = assigned.has(layer.id);
          const layerCategoriesElsewhere = countLayerAssignmentsExcluding(
            workingTree,
            layer.id,
            selectedNode.id,
          );
          return (
            <li key={layer.id}>
              <label className="flex items-center gap-2 px-2 py-1 rounded hover:bg-fog-gray/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleLayer(selectedNode.id, layer.id)}
                  className="accent-deep-teal"
                />
                <span className="flex-1 text-xs text-slate-blue truncate" title={layer.name}>
                  {layer.name}
                </span>
                {layerCategoriesElsewhere > 0 && (
                  <span
                    className="text-[10px] text-slate-blue/40"
                    title={`Also assigned to ${layerCategoriesElsewhere} other categor${
                      layerCategoriesElsewhere === 1 ? 'y' : 'ies'
                    }`}
                  >
                    +{layerCategoriesElsewhere}
                  </span>
                )}
                <span className="text-[10px] text-slate-blue/30 font-mono shrink-0">{layer.id}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function countLayerAssignmentsExcluding(
  nodes: readonly EditorNode[],
  layerId: string,
  excludeNodeId: string,
): number {
  let n = 0;
  function walk(arr: readonly EditorNode[]): void {
    for (const x of arr) {
      if (x.id !== excludeNodeId && x.layers.includes(layerId)) n++;
      walk(x.children);
    }
  }
  walk(nodes);
  return n;
}

export function CategoryTreeEditor() {
  const [serverTree, setServerTree] = useState<CategoryTree | null>(null);
  const [workingTree, setWorkingTree] = useState<EditorNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Ids of categories created in this editing session — their slug can still
  // change as the user types a label. After a successful save, this clears
  // (every node is now "saved" and its slug locks).
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const treeRef = useRef<TreeApi<EditorNode>>(null);

  useEffect(() => {
    fetchCategoryTree().then(t => {
      setServerTree(t);
      setWorkingTree(cloneTree(t.tree));
      setLoading(false);
    });
  }, []);

  const dirty = useMemo(() => {
    if (!serverTree) return false;
    return JSON.stringify(workingTree) !== JSON.stringify(serverTree.tree);
  }, [workingTree, serverTree]);

  const orphanIds = useMemo(() => {
    const assigned = collectAssignedLayerIds(workingTree);
    return layerConfigs.filter(l => !assigned.has(l.id)).map(l => l.id);
  }, [workingTree]);

  const emptyCategoryLabels = useMemo(() => {
    function nodeIsRendered(node: EditorNode): boolean {
      if (node.layers.length > 0) return true;
      return node.children.some(nodeIsRendered);
    }
    const empties: string[] = [];
    function walk(nodes: EditorNode[]) {
      for (const n of nodes) {
        if (!nodeIsRendered(n)) empties.push(n.label);
        walk(n.children);
      }
    }
    walk(workingTree);
    return empties;
  }, [workingTree]);

  const selectedNode = useMemo(
    () => (selectedId ? findNodeById(workingTree, selectedId) : null),
    [selectedId, workingTree],
  );

  function handleAddRoot() {
    const ids = collectIds(workingTree);
    const label = 'New Category';
    const id = uniqueId(slugify(label), ids);
    setWorkingTree([...workingTree, { id, label, layers: [], children: [] }]);
    setNewIds((prev) => new Set(prev).add(id));
    setTimeout(() => { setEditingId(id); setSelectedId(id); }, 0);
  }

  function handleAddChild(parentId: string) {
    const ids = collectIds(workingTree);
    const label = 'New Category';
    const id = uniqueId(slugify(label), ids);
    setWorkingTree(addChildTo(workingTree, parentId, { id, label, layers: [], children: [] }));
    setNewIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      treeRef.current?.open(parentId);
      setEditingId(id);
      setSelectedId(id);
    }, 0);
  }

  function handleRename(id: string, rawLabel: string) {
    const label = rawLabel.trim();
    if (!label) return;

    // For nodes added in this session, keep the slug in sync with the label.
    // Once a node has been saved (id not in newIds), its slug is locked.
    if (newIds.has(id)) {
      const takenExceptThis = new Set(
        Array.from(collectIds(workingTree)).filter((existing) => existing !== id),
      );
      const newId = uniqueId(slugify(label), takenExceptThis);
      setWorkingTree(updateNode(workingTree, id, (n) => ({ ...n, id: newId, label })));
      if (newId !== id) {
        setNewIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          next.add(newId);
          return next;
        });
        if (selectedId === id) setSelectedId(newId);
        if (editingId === id) setEditingId(null);
      }
      return;
    }

    setWorkingTree(updateNode(workingTree, id, (n) => ({ ...n, label })));
  }

  function handleDelete(id: string) {
    setWorkingTree(removeNode(workingTree, id));
    if (selectedId === id) setSelectedId(null);
    if (newIds.has(id)) {
      setNewIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  function handleMove(args: { dragIds: string[]; parentId: string | null; index: number }) {
    setWorkingTree(moveNodes(workingTree, args.dragIds, args.parentId, args.index));
  }

  function handleToggleLayer(categoryId: string, layerId: string) {
    setWorkingTree(toggleLayerInNode(workingTree, categoryId, layerId));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const token = getAdminToken();
      if (!token) {
        setError('Not signed in.');
        return;
      }
      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': token,
        },
        body: JSON.stringify({ tree: workingTree }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        if (res.status === 401) {
          throw new Error('Unauthorized — sign out and back in with the correct password.');
        }
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const fresh: CategoryTree = await res.json();
      clearCache();
      setServerTree(fresh);
      setWorkingTree(cloneTree(fresh.tree));
      setNewIds(new Set()); // all rows are now "saved" — slugs lock
      setSuccess(`Saved (version ${fresh.version}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    if (!serverTree) return;
    setWorkingTree(cloneTree(serverTree.tree));
    setNewIds(new Set());
    setError(null);
    setSuccess(null);
  }

  if (loading) {
    return (
      <div className="max-w-5xl">
        <h1 className="text-xl font-semibold text-slate-blue mb-2">Categories</h1>
        <p className="text-sm text-slate-blue/50">Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-baseline gap-3 mb-2">
        <h1 className="text-xl font-semibold text-slate-blue">Categories</h1>
        {serverTree && (
          <span className="text-xs text-slate-blue/40">
            v{serverTree.version}
            {serverTree.updated_at ? ` · saved ${serverTree.updated_at}` : ''}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-blue/70 mb-4">
        Organize the sidebar's category groups. Drag rows to reorder or nest. Double-click a name to rename. Click a
        category to see and manage which datasets are listed inside it. A dataset can belong to more than one category.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={handleAddRoot}
          className="text-xs px-2.5 py-1 bg-deep-teal text-white rounded hover:bg-deep-teal-light transition-colors"
        >
          + Add root category
        </button>
        <div className="flex-1" />
        {dirty && (
          <>
            <button
              onClick={handleDiscard}
              disabled={saving}
              className="text-xs px-2.5 py-1 text-slate-blue/70 hover:text-slate-blue hover:bg-fog-gray rounded transition-colors disabled:opacity-50"
            >
              Discard changes
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs px-3 py-1 bg-slate-blue text-white rounded hover:bg-slate-blue/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </div>

      {success && (
        <div className="mb-3 px-3 py-2 bg-green-50 border border-green-200 text-sm text-green-800 rounded">
          {success}
        </div>
      )}
      {error && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-sm text-red-800 rounded">
          {error}
        </div>
      )}
      {orphanIds.length > 0 && (
        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 text-xs text-amber-900 rounded">
          <strong>{orphanIds.length} layer{orphanIds.length === 1 ? '' : 's'} not assigned to any category</strong>
          {' — won\'t appear in the public sidebar until assigned: '}
          <span className="font-mono">{orphanIds.join(', ')}</span>
        </div>
      )}
      {emptyCategoryLabels.length > 0 && (
        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 text-xs text-amber-900 rounded">
          <strong>
            {emptyCategoryLabels.length} empty categor{emptyCategoryLabels.length === 1 ? 'y' : 'ies'}
          </strong>
          {' — won\'t appear in the public sidebar until you assign layers to '}
          {emptyCategoryLabels.length === 1 ? 'it' : 'them'}: <em>{emptyCategoryLabels.join(', ')}</em>
        </div>
      )}

      <div className="flex gap-4">
        <div className="flex-1 bg-white border border-fog-gray-dark/40 rounded-lg p-2 min-w-0">
          {workingTree.length === 0 ? (
            <p className="text-sm text-slate-blue/40 italic p-3">
              No categories yet. Click "Add root category" to begin.
            </p>
          ) : (
            <Tree
              ref={treeRef}
              data={workingTree}
              onMove={handleMove}
              onSelect={(nodes) => {
                if (nodes.length > 0) setSelectedId(nodes[0].id);
              }}
              rowHeight={36}
              width="100%"
              height={600}
              indent={24}
              openByDefault={false}
            >
              {(props) => (
                <CategoryRow
                  {...props}
                  editingId={editingId}
                  setEditingId={setEditingId}
                  selectedId={selectedId}
                  setSelectedId={setSelectedId}
                  onRename={handleRename}
                  onAddChild={handleAddChild}
                  onDelete={handleDelete}
                />
              )}
            </Tree>
          )}
        </div>

        <div className="w-96 bg-white border border-fog-gray-dark/40 rounded-lg p-3" style={{ height: 620 }}>
          <LayerAssignmentPanel
            selectedNode={selectedNode}
            workingTree={workingTree}
            onToggleLayer={handleToggleLayer}
          />
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  clearSiteContentCache,
  DEFAULT_SITE_CONTENT,
  type SiteContent,
} from '../../services/siteContent';
import { LandingIntroCard } from '../Map/LandingIntro';
import { getAdminToken } from './AuthGate';

const CONTENT_API = '/api/admin/content';

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

interface ToolButtonProps {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}

function ToolButton({ active = false, disabled = false, title, onClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
      className={`h-8 min-w-8 px-2 rounded text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active
          ? 'bg-deep-teal text-white'
          : 'text-slate-blue hover:bg-fog-gray'
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-fog-gray-dark/60 mx-1" aria-hidden />;
}

function Toolbar({ editor }: { editor: Editor }) {
  function setLink() {
    const previous = editor.getAttributes('link').href as string | undefined;
    const input = window.prompt('Link URL (leave empty to remove the link)', previous ?? 'https://');
    if (input === null) return; // cancelled
    const url = input.trim();
    if (!url || url === 'https://') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: url, target: '_blank' })
      .run();
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-fog-gray-dark/40 bg-fog-gray/40 rounded-t-md">
      <ToolButton
        title="Bold (⌘B)"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <span className="font-bold">B</span>
      </ToolButton>
      <ToolButton
        title="Italic (⌘I)"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="italic font-serif">I</span>
      </ToolButton>
      <ToolButton
        title="Underline (⌘U)"
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <span className="underline">U</span>
      </ToolButton>
      <Divider />
      <ToolButton
        title="Heading"
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H
      </ToolButton>
      <ToolButton
        title="Paragraph"
        active={editor.isActive('paragraph')}
        onClick={() => editor.chain().focus().setParagraph().run()}
      >
        ¶
      </ToolButton>
      <Divider />
      <ToolButton
        title="Bulleted list"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      </ToolButton>
      <ToolButton
        title="Numbered list"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <span className="text-xs tracking-tight">1.</span>
      </ToolButton>
      <Divider />
      <ToolButton
        title="Add or edit link"
        active={editor.isActive('link')}
        onClick={setLink}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </ToolButton>
      <ToolButton
        title="Clear formatting"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <span className="text-xs">Clear</span>
      </ToolButton>
      <span className="flex-1" />
      <ToolButton
        title="Undo (⌘Z)"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        ↶
      </ToolButton>
      <ToolButton
        title="Redo (⇧⌘Z)"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        ↷
      </ToolButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor module
// ---------------------------------------------------------------------------

/**
 * /admin/content — edits the rich-text intro box shown on the public map's
 * landing page. Light formatting only (bold, italic, underline, links, lists,
 * one heading level). The Cloud Function sanitizes the HTML to that same
 * allowlist on save, so anything outside it is dropped server-side.
 */
export function LandingIntroEditor() {
  const [server, setServer] = useState<SiteContent | null>(null);
  const [draftHtml, setDraftHtml] = useState('');
  // The server HTML as re-serialized by the editor's own schema. Comparing
  // against this (not the raw server string) avoids a false "Unsaved changes"
  // right after load, since TipTap normalizes whatever markup it's given.
  const [baselineHtml, setBaselineHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3] },
        // Not part of the "light formatting" set — keep the toolbar and the
        // server allowlist in lockstep.
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
        },
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'rich-text tiptap-editor text-sm text-slate-blue px-4 py-3 min-h-[16rem] focus:outline-none',
      },
    },
    onUpdate: ({ editor: e }) => setDraftHtml(e.getHTML()),
  });

  // Initial load — always go through the API so admins see the freshest copy
  // (the public GCS URL is fine for the map, but this avoids any edge cache).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(CONTENT_API, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SiteContent;
        if (cancelled) return;
        const normalized: SiteContent = {
          version: data.version ?? 0,
          updated_at: data.updated_at ?? null,
          landing_intro: { html: data.landing_intro?.html ?? '' },
        };
        setServer(normalized);
        setDraftHtml(normalized.landing_intro.html);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setServer(DEFAULT_SITE_CONTENT);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Push server content into the editor once both are ready.
  useEffect(() => {
    if (!editor || !server) return;
    editor.commands.setContent(server.landing_intro.html, { emitUpdate: false });
    const html = editor.getHTML();
    setBaselineHtml(html);
    setDraftHtml(html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, server?.version]);

  const dirty = server !== null && draftHtml !== baselineHtml;

  async function handleSave() {
    if (!editor) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const token = getAdminToken();
      if (!token) {
        setError('Not signed in.');
        return;
      }
      const res = await fetch(CONTENT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ landing_intro: { html: editor.getHTML() } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        if (res.status === 401) {
          throw new Error('Unauthorized — sign out and back in with the correct password.');
        }
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const fresh = (await res.json()) as SiteContent;
      clearSiteContentCache();
      setServer(fresh);
      setSuccess(`Saved (version ${fresh.version}). The map will show this on its next page load.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    if (!editor || !server) return;
    editor.commands.setContent(server.landing_intro.html, { emitUpdate: false });
    setDraftHtml(editor.getHTML());
    setError(null);
    setSuccess(null);
  }

  if (loading || !editor) {
    return (
      <div className="max-w-5xl">
        <h1 className="text-xl font-semibold text-slate-blue mb-2">Landing page intro</h1>
        <p className="text-sm text-slate-blue/50">Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-baseline gap-3 mb-2">
        <h1 className="text-xl font-semibold text-slate-blue">Landing page intro</h1>
        {server && (
          <span className="text-xs text-slate-blue/40">
            v{server.version}
            {server.updated_at ? ` · saved ${server.updated_at}` : ''}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-blue/70 mb-4">
        This text appears in a box on the map when visitors first arrive. Use it for a short welcome and
        instructions — for example, how to search an address or zoom to explore. Leave it empty to hide the
        box.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="bg-deep-teal text-white text-sm font-medium px-3 py-1.5 rounded-md hover:bg-deep-teal-light transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={handleDiscard}
          disabled={!dirty || saving}
          className="text-sm text-slate-blue/70 hover:text-slate-blue px-3 py-1.5 rounded-md hover:bg-fog-gray transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Discard changes
        </button>
        {dirty && !saving && (
          <span className="text-xs text-driftwood font-medium">Unsaved changes</span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
        {success && !dirty && <span className="text-xs text-forest-green-light">{success}</span>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24rem] gap-6 items-start">
        <div className="bg-white rounded-md border border-fog-gray-dark/60 shadow-sm">
          <Toolbar editor={editor} />
          <EditorContent editor={editor} />
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-blue/40 mb-2">
            Preview — as shown on the map
          </p>
          <div className="relative rounded-lg overflow-hidden bg-gradient-to-br from-ocean-blue to-slate-blue p-3 min-h-[12rem]">
            {draftHtml.replace(/<[^>]*>/g, '').trim() ? (
              <LandingIntroCard html={draftHtml} className="relative w-full" />
            ) : (
              <p className="text-xs text-white/70 italic p-2">Empty — the box will be hidden on the map.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { presets, type Preset } from '../src/config/presets';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');
const templatePath = resolve(distDir, 'index.html');

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildMetaBlock(preset: Preset): string {
  const { title, description, ogImage, ogUrl } = preset.meta;
  return [
    `    <meta name="description" content="${escapeAttr(description)}" />`,
    `    <meta property="og:title" content="${escapeAttr(title)}" />`,
    `    <meta property="og:description" content="${escapeAttr(description)}" />`,
    `    <meta property="og:image" content="${escapeAttr(ogImage)}" />`,
    `    <meta property="og:url" content="${escapeAttr(ogUrl)}" />`,
    `    <meta property="og:type" content="website" />`,
    `    <meta name="twitter:card" content="summary_large_image" />`,
  ].join('\n');
}

function renderPresetHtml(template: string, preset: Preset): string {
  const newTitle = `<title>${escapeText(preset.meta.title)}</title>`;
  const withTitle = template.replace(/<title>[^<]*<\/title>/, newTitle);
  const metaBlock = buildMetaBlock(preset);
  return withTitle.replace('</head>', `${metaBlock}\n  </head>`);
}

function main() {
  const template = readFileSync(templatePath, 'utf8');
  const names = Object.keys(presets);

  if (names.length === 0) {
    console.log('No presets defined; nothing to generate.');
    return;
  }

  for (const name of names) {
    const preset = presets[name];
    const outDir = resolve(distDir, 'view', name);
    mkdirSync(outDir, { recursive: true });
    const html = renderPresetHtml(template, preset);
    writeFileSync(resolve(outDir, 'index.html'), html, 'utf8');
    console.log(`  → dist/view/${name}/index.html`);
  }

  console.log(`Generated ${names.length} preset HTML file(s).`);
}

main();

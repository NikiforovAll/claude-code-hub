import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Astro bundles this module, so paths come from the website folder the build runs in, not from import.meta.url.
const SITE = process.cwd();
const REGISTRY = path.join(SITE, 'src', 'content', 'extensions');
const CACHE = path.join(SITE, 'node_modules', '.cache', 'extensions');
const { manifestError } = createRequire(path.join(SITE, 'package.json'))('../lib/apps.js');

const SOURCE_RE = /^github:([\w.-]+)\/([\w.-]+)(?:\/(.+))?$/;
const SHA_RE = /^[0-9a-f]{40}$/;

export interface Extension {
  id: string;
  name: string;
  kind: 'app' | 'addon' | 'feature';
  official: boolean;
  order: number;
  tagline: string;
  description?: string;
  tags: string[];
  screenshots: { src: string; alt: string; title?: string; caption?: string }[];
  card?: string;
  author?: string;
  homepage?: string;
  license?: string;
  requires: { hub?: string; node?: string; apps?: string[]; os?: string[]; tools?: { name: string; url?: string; optional?: boolean }[] };
  plugin?: string;
  source: string;
  sha: string;
  pinned: boolean;
  tree: string;
  install: string;
}

// EXTENSIONS_LOCAL=<id>=<dir>,… reads those extensions from local folders (relative to website/), to preview a
// manifest before its commit is pushed. The deploy build does not set it.
function localDirs(): Map<string, string> {
  const pairs = (process.env.EXTENSIONS_LOCAL ?? '').split(',').filter(Boolean);
  return new Map(pairs.map((p) => p.split('=', 2) as [string, string]).map(([id, dir]) => [id, path.resolve(SITE, dir)]));
}

// A file of the extension at a commit, or null when it does not exist. Cached by SHA, because a commit never changes.
async function readAt(src: { owner: string; repo: string; subdir: string }, sha: string, rel: string, local?: string) {
  if (local) {
    const file = path.join(local, rel);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }
  const key = path.join(CACHE, src.owner, src.repo, sha, src.subdir, rel);
  if (fs.existsSync(key)) return fs.readFileSync(key, 'utf8');
  if (fs.existsSync(`${key}.missing`)) return null;
  const url = `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${sha}/${[src.subdir, rel].filter(Boolean).join('/')}`;
  const res = await fetch(url);
  fs.mkdirSync(path.dirname(key), { recursive: true });
  if (res.status === 404) {
    fs.writeFileSync(`${key}.missing`, '');
    return null;
  }
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(key, text);
  return text;
}

// The commit at the tip of the default branch. Kept per process, so a dev server asks once, not on every page view.
// git ls-remote, because the REST API allows 60 requests an hour per IP without a token.
const heads = new Map<string, Promise<string>>();
function head(owner: string, repo: string): Promise<string> {
  const key = `${owner}/${repo}`;
  if (!heads.has(key)) {
    const sha = execFileAsync('git', ['ls-remote', `https://github.com/${key}.git`, 'HEAD'], { timeout: 30_000 }).then(
      ({ stdout }) => {
        const text = stdout.split(/\s/)[0];
        if (!SHA_RE.test(text)) throw new Error(`${key}: default branch head: ${stdout.slice(0, 200)}`);
        return text;
      },
    );
    sha.catch(() => heads.delete(key));
    heads.set(key, sha);
  }
  return heads.get(key)!;
}

async function loadOne(file: string, local: Map<string, string>): Promise<Extension> {
  const id = path.basename(file, '.json');
  const entry = JSON.parse(fs.readFileSync(path.join(REGISTRY, file), 'utf8'));
  const m = SOURCE_RE.exec(entry.source ?? '');
  if (!m) throw new Error(`${file}: source is not github:<owner>/<repo>[/<dir>]`);
  const pinned = entry.sha !== undefined;
  if (pinned && !SHA_RE.test(entry.sha)) throw new Error(`${file}: sha is not a full commit SHA`);
  // Only an official extension follows its default branch: every other one was reviewed at the commit it pins.
  if (!pinned && entry.official !== true) throw new Error(`${file}: sha is missing`);
  const src = { owner: m[1], repo: m[2], subdir: m[3] ?? '' };
  const sha: string = pinned ? entry.sha : await head(src.owner, src.repo);
  const dir = local.get(id);
  let kind: Extension['kind'] | undefined;
  let text: string | null = null;
  for (const [k, name] of [['app', 'hub-app.json'], ['addon', 'addon.json'], ['feature', 'feature.json']] as const) {
    text = await readAt(src, sha, name, dir);
    if (text !== null) {
      kind = k;
      break;
    }
  }
  if (text === null || !kind) throw new Error(`${file}: no hub-app.json, addon.json or feature.json at ${entry.source}@${sha}`);
  const manifest = JSON.parse(text);
  // cck owns the add-on manifest and checks it on install; the site reads only what it shows.
  // The app manifest is checked against a folder that does not exist, so containment is a check of the path text.
  const err =
    kind === 'addon' ? addonError(manifest, id) : kind === 'feature' ? featureError(manifest, id) : manifestError(manifest, id, path.resolve(SITE, '.extension-root'));
  if (err) throw new Error(`${file}: ${err}`);
  const listing = manifest.listing ?? {};
  if (!listing.tagline) throw new Error(`${file}: listing.tagline is missing`);
  const at = (rel: string) => `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${sha}/${[src.subdir, rel].filter(Boolean).join('/')}`;
  const shots = (listing.screenshots ?? []).map(
    (s: { path?: string; url?: string; alt: string; title?: string; caption?: string; card?: boolean }) => ({
      src: s.url ?? at(s.path!),
      alt: s.alt,
      title: s.title,
      caption: s.caption,
      card: s.card === true,
    }),
  );
  return {
    id,
    name: (kind === 'app' ? manifest.name : manifest.title) ?? id,
    kind,
    official: entry.official === true,
    order: typeof entry.order === 'number' ? entry.order : Number.MAX_SAFE_INTEGER,
    tagline: listing.tagline,
    description: listing.description,
    tags: listing.tags ?? [],
    screenshots: shots,
    card: (shots.find((s) => s.card) ?? shots[0])?.src,
    author: listing.author,
    homepage: listing.homepage,
    license: listing.license,
    requires: manifest.requires ?? {},
    plugin: manifest.plugin?.name,
    source: entry.source,
    sha,
    pinned,
    tree: `https://github.com/${src.owner}/${src.repo}/tree/${pinned ? sha : 'HEAD'}/${src.subdir}`,
    install: `claude-code-hub ext install ${id}`,
  };
}

function addonError(m: { kind?: unknown; id?: unknown; title?: unknown; url?: unknown }, id: string): string | null {
  if (m.kind !== 'addon') return 'addon.json kind is not "addon"';
  if (m.id !== id) return `addon.json id is not ${id}`;
  if (typeof m.title !== 'string' || typeof m.url !== 'string') return 'addon.json needs title and url';
  return null;
}

function featureError(m: { kind?: unknown; id?: unknown; title?: unknown; config?: unknown }, id: string): string | null {
  if (m.kind !== 'feature') return 'feature.json kind is not "feature"';
  if (m.id !== id) return `feature.json id is not ${id}`;
  if (typeof m.title !== 'string' || !m.config || typeof m.config !== 'object') return 'feature.json needs title and config';
  return null;
}

async function load(): Promise<Extension[]> {
  const local = localDirs();
  const files = fs.readdirSync(REGISTRY).filter((f) => f.endsWith('.json'));
  const all = await Promise.all(files.map((f) => loadOne(f, local)));
  return all.sort((a, b) => a.order - b.order || Number(b.official) - Number(a.official) || a.name.localeCompare(b.name));
}

// An image on this site loads by path, so a dev server or preview shows a shot before it is deployed.
export function onSite(src: string): string {
  const home = new URL(import.meta.env.BASE_URL, import.meta.env.SITE).href;
  return src.startsWith(home) ? new URL(src).pathname : src;
}

let loading: Promise<Extension[]> | undefined;
export const loadExtensions = () => (import.meta.env.DEV ? load() : (loading ??= load()));

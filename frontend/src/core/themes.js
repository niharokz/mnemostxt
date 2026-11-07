// Colour themes. A theme is a flat map of colour names (below) to CSS colours;
// applyTheme() turns it into the CSS variables the app and editor read
// (--nss-* for the interface, --ed-* for the editor, --syn-* for syntax).
//
// Users add their own in settings.json, under "themes" (shared by every device):
//   "themes": { "my-blue": { "label": "My blue", "base": "nord", "keyword": "#ffcc00" } }
// "base" names the theme to start from (default nss-dark), "label" is its
// name in menus, "mode" is dark or light; every other key overrides one colour
// (the names are in COLOR_KEYS below). Preferences → Appearance has a colour editor for them.

// Every colour a theme can set, grouped for the editor in Preferences.
export const COLOR_GROUPS = [
  ['Interface', ['bg', 'surface', 'surface2', 'line', 'fg', 'muted', 'accent', 'ink', 'accent2', 'onAccent', 'ok', 'warn', 'bad']],
  ['Editor', ['gutter', 'activeLine', 'selection', 'match', 'matchStrong', 'whitespace']],
  ['Syntax', ['comment', 'keyword', 'control', 'string', 'escape', 'regexp', 'number', 'constant', 'function', 'builtin', 'type', 'class',
    'namespace', 'def', 'property', 'attribute', 'variable', 'tag', 'operator', 'punct', 'meta', 'heading', 'link', 'labels', 'inserted', 'deleted', 'changed']],
];
export const COLOR_KEYS = COLOR_GROUPS.flatMap(([, keys]) => keys);
const UI_KEYS = new Set(COLOR_GROUPS[0][1]);
const ED_KEYS = new Set(COLOR_GROUPS[1][1]);

// Plain-language names for the colour editor.
export const COLOR_LABELS = {
  bg: 'Background', surface: 'Panels', surface2: 'Panels, raised', line: 'Borders', fg: 'Text', muted: 'Muted text', accent: 'Accent',
  ink: 'Accent text', accent2: 'Second accent', onAccent: 'Text on accent', ok: 'Good', warn: 'Warning', bad: 'Error',
  gutter: 'Line numbers', activeLine: 'Current line', selection: 'Selection', match: 'Matches', matchStrong: 'Current match', whitespace: 'Whitespace dots',
  comment: 'Comments', keyword: 'Keywords', control: 'Control flow (if, return)', string: 'Strings', escape: 'Escapes (\\n)', regexp: 'Regular expressions',
  number: 'Numbers', constant: 'Constants (true, null)', function: 'Functions', builtin: 'Built-ins', type: 'Types', class: 'Classes', namespace: 'Namespaces',
  def: 'Definitions', property: 'Properties and keys', attribute: 'Attributes', variable: 'Variables', tag: 'Tags', operator: 'Operators', punct: 'Punctuation',
  meta: 'Meta and annotations', heading: 'Headings', link: 'Links', labels: 'Labels (goto, loops)', inserted: 'Diff: added', deleted: 'Diff: removed', changed: 'Diff: changed',
};

// Syntax colours a theme may leave out, and what they fall back to.
const FALLBACK = { control: 'keyword', escape: 'regexp', constant: 'number', builtin: 'function', class: 'type', namespace: 'type', attribute: 'property',
  operator: 'punct', labels: 'def', heading: 'ink', link: 'accent2', inserted: 'ok', deleted: 'bad', changed: 'warn', def: 'fg', variable: 'fg' };

const rgba = (hex, a) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return hex;
  let s = m[1];
  if (s.length === 3) s = [...s].map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// ── built-in themes ────────────────────────────────────────
export const BUILTIN = {
  'nss-dark': {
    label: 'nss dark', mode: 'dark',
    bg: '#070b0f', surface: '#0f161b', surface2: '#152027', line: '#1f2c33', fg: '#e6ecec', muted: '#8b979a',
    accent: '#3a807a', ink: '#66bdb3', accent2: '#a9b8ff', onAccent: '#ffffff', ok: '#3fb27f', warn: '#e0a63a', bad: '#ff6b6b',
    gutter: '#46565c', activeLine: 'rgba(102, 189, 179, .055)', selection: 'rgba(58, 128, 122, .42)', match: 'rgba(169, 184, 255, .16)',
    matchStrong: 'rgba(169, 184, 255, .34)', whitespace: 'rgba(139, 151, 154, .45)',
    comment: '#6a7b80', keyword: '#a9b8ff', control: '#c39ce8', string: '#8fdccf', escape: '#f2c46d', regexp: '#e0a63a', number: '#f2935f',
    constant: '#ff9e7a', function: '#66bdb3', builtin: '#7fd1e8', type: '#e0c07a', class: '#f0d48a', namespace: '#b9c98a', def: '#d6e2e2',
    property: '#9fc9e8', attribute: '#b4d98c', variable: '#e6ecec', tag: '#66bdb3', operator: '#9fb3b8', punct: '#8b979a', meta: '#c39ce8',
    heading: '#66bdb3', link: '#a9b8ff', labels: '#e0a63a',
  },
  'nss-light': {
    label: 'nss light', mode: 'light',
    bg: '#f6f8f8', surface: '#ffffff', surface2: '#eaf1f0', line: '#d7e2e0', fg: '#14201f', muted: '#5c6b6a',
    accent: '#3a807a', ink: '#2c6a64', accent2: '#4b5bb5', onAccent: '#ffffff', ok: '#1f8a5a', warn: '#a86a00', bad: '#d63c3c',
    gutter: '#9aa9a7', activeLine: 'rgba(58, 128, 122, .06)', selection: 'rgba(58, 128, 122, .25)', match: 'rgba(75, 91, 181, .12)',
    matchStrong: 'rgba(75, 91, 181, .26)', whitespace: 'rgba(92, 107, 106, .45)',
    comment: '#7b8a89', keyword: '#4b5bb5', control: '#7b45a8', string: '#1f7a6d', escape: '#9a5b00', regexp: '#a86a00', number: '#c4501a',
    constant: '#b8361e', function: '#2c6a64', builtin: '#1d6f8f', type: '#8a6400', class: '#7a5300', namespace: '#5c7020', def: '#14201f',
    property: '#2d6a96', attribute: '#4f7a1f', variable: '#14201f', tag: '#2c6a64', operator: '#4d5d5c', punct: '#5c6b6a', meta: '#7b45a8',
    heading: '#2c6a64', link: '#4b5bb5', labels: '#a86a00',
  },
  'solarized-dark': {
    label: 'Solarized dark', mode: 'dark',
    bg: '#002b36', surface: '#073642', surface2: '#0b4050', line: '#124b5a', fg: '#93a1a1', muted: '#657b83',
    accent: '#268bd2', ink: '#2aa198', accent2: '#6c71c4', onAccent: '#fdf6e3', ok: '#859900', warn: '#b58900', bad: '#dc322f',
    gutter: '#586e75', activeLine: 'rgba(147, 161, 161, .06)', selection: 'rgba(38, 139, 210, .32)', match: 'rgba(181, 137, 0, .18)',
    matchStrong: 'rgba(181, 137, 0, .36)', whitespace: 'rgba(88, 110, 117, .6)',
    comment: '#586e75', keyword: '#859900', control: '#cb4b16', string: '#2aa198', escape: '#dc322f', regexp: '#dc322f', number: '#d33682',
    constant: '#cb4b16', function: '#268bd2', builtin: '#6c71c4', type: '#b58900', class: '#b58900', namespace: '#6c71c4', def: '#93a1a1',
    property: '#268bd2', attribute: '#b58900', variable: '#93a1a1', tag: '#268bd2', operator: '#859900', punct: '#839496', meta: '#cb4b16',
    heading: '#cb4b16', link: '#6c71c4', labels: '#d33682',
  },
  'solarized-light': {
    label: 'Solarized light', mode: 'light',
    bg: '#fdf6e3', surface: '#eee8d5', surface2: '#e6dfc8', line: '#d9d2bc', fg: '#586e75', muted: '#839496',
    accent: '#268bd2', ink: '#1f7a9e', accent2: '#6c71c4', onAccent: '#fdf6e3', ok: '#859900', warn: '#b58900', bad: '#dc322f',
    gutter: '#93a1a1', activeLine: 'rgba(88, 110, 117, .06)', selection: 'rgba(38, 139, 210, .22)', match: 'rgba(181, 137, 0, .16)',
    matchStrong: 'rgba(181, 137, 0, .32)', whitespace: 'rgba(147, 161, 161, .7)',
    comment: '#93a1a1', keyword: '#859900', control: '#cb4b16', string: '#2aa198', escape: '#dc322f', regexp: '#dc322f', number: '#d33682',
    constant: '#cb4b16', function: '#268bd2', builtin: '#6c71c4', type: '#b58900', class: '#b58900', namespace: '#6c71c4', def: '#586e75',
    property: '#268bd2', attribute: '#b58900', variable: '#586e75', tag: '#268bd2', operator: '#859900', punct: '#657b83', meta: '#cb4b16',
    heading: '#cb4b16', link: '#6c71c4', labels: '#d33682',
  },
  nord: {
    label: 'Nord', mode: 'dark',
    bg: '#2e3440', surface: '#3b4252', surface2: '#434c5e', line: '#4c566a', fg: '#d8dee9', muted: '#9aa5b8',
    accent: '#5e81ac', ink: '#88c0d0', accent2: '#81a1c1', onAccent: '#eceff4', ok: '#a3be8c', warn: '#ebcb8b', bad: '#bf616a',
    gutter: '#616e88', activeLine: 'rgba(216, 222, 233, .05)', selection: 'rgba(94, 129, 172, .4)', match: 'rgba(136, 192, 208, .16)',
    matchStrong: 'rgba(136, 192, 208, .32)', whitespace: 'rgba(97, 110, 136, .8)',
    comment: '#616e88', keyword: '#81a1c1', control: '#b48ead', string: '#a3be8c', escape: '#ebcb8b', regexp: '#ebcb8b', number: '#b48ead',
    constant: '#d08770', function: '#88c0d0', builtin: '#8fbcbb', type: '#8fbcbb', class: '#8fbcbb', namespace: '#8fbcbb', def: '#eceff4',
    property: '#88c0d0', attribute: '#8fbcbb', variable: '#d8dee9', tag: '#81a1c1', operator: '#81a1c1', punct: '#a4adbd', meta: '#5e81ac',
    heading: '#88c0d0', link: '#81a1c1', labels: '#d08770',
  },
  gruvbox: {
    label: 'Gruvbox', mode: 'dark',
    bg: '#282828', surface: '#32302f', surface2: '#3c3836', line: '#504945', fg: '#ebdbb2', muted: '#a89984',
    accent: '#458588', ink: '#83a598', accent2: '#d3869b', onAccent: '#fbf1c7', ok: '#b8bb26', warn: '#fabd2f', bad: '#fb4934',
    gutter: '#7c6f64', activeLine: 'rgba(235, 219, 178, .05)', selection: 'rgba(131, 165, 152, .3)', match: 'rgba(250, 189, 47, .16)',
    matchStrong: 'rgba(250, 189, 47, .32)', whitespace: 'rgba(124, 111, 100, .7)',
    comment: '#928374', keyword: '#fb4934', control: '#fb4934', string: '#b8bb26', escape: '#fe8019', regexp: '#fe8019', number: '#d3869b',
    constant: '#d3869b', function: '#b8bb26', builtin: '#fe8019', type: '#fabd2f', class: '#fabd2f', namespace: '#8ec07c', def: '#83a598',
    property: '#83a598', attribute: '#8ec07c', variable: '#ebdbb2', tag: '#8ec07c', operator: '#fe8019', punct: '#a89984', meta: '#8ec07c',
    heading: '#fabd2f', link: '#83a598', labels: '#d3869b',
  },
  dracula: {
    label: 'Dracula-style', mode: 'dark',
    bg: '#282a36', surface: '#2f3241', surface2: '#383b4c', line: '#44475a', fg: '#f8f8f2', muted: '#a0a6c7',
    accent: '#7c62d6', ink: '#bd93f9', accent2: '#8be9fd', onAccent: '#ffffff', ok: '#50fa7b', warn: '#f1fa8c', bad: '#ff5555',
    gutter: '#6272a4', activeLine: 'rgba(248, 248, 242, .04)', selection: 'rgba(98, 114, 164, .5)', match: 'rgba(241, 250, 140, .14)',
    matchStrong: 'rgba(241, 250, 140, .3)', whitespace: 'rgba(98, 114, 164, .7)',
    comment: '#6272a4', keyword: '#ff79c6', control: '#ff79c6', string: '#f1fa8c', escape: '#ffb86c', regexp: '#ff5555', number: '#bd93f9',
    constant: '#bd93f9', function: '#50fa7b', builtin: '#8be9fd', type: '#8be9fd', class: '#8be9fd', namespace: '#8be9fd', def: '#f8f8f2',
    property: '#66d9ef', attribute: '#50fa7b', variable: '#f8f8f2', tag: '#ff79c6', operator: '#ff79c6', punct: '#c0c4dc', meta: '#ffb86c',
    heading: '#bd93f9', link: '#8be9fd', labels: '#ffb86c',
  },
  monokai: {
    label: 'Monokai-style', mode: 'dark',
    bg: '#272822', surface: '#2e2f29', surface2: '#3a3b33', line: '#49483e', fg: '#f8f8f2', muted: '#a59f85',
    accent: '#5f8a2a', ink: '#a6e22e', accent2: '#66d9ef', onAccent: '#ffffff', ok: '#a6e22e', warn: '#e6db74', bad: '#f92672',
    gutter: '#75715e', activeLine: 'rgba(248, 248, 242, .04)', selection: 'rgba(73, 72, 62, .9)', match: 'rgba(230, 219, 116, .15)',
    matchStrong: 'rgba(230, 219, 116, .32)', whitespace: 'rgba(117, 113, 94, .7)',
    comment: '#75715e', keyword: '#f92672', control: '#f92672', string: '#e6db74', escape: '#ae81ff', regexp: '#fd971f', number: '#ae81ff',
    constant: '#ae81ff', function: '#a6e22e', builtin: '#66d9ef', type: '#66d9ef', class: '#a6e22e', namespace: '#66d9ef', def: '#fd971f',
    property: '#a6e22e', attribute: '#a6e22e', variable: '#f8f8f2', tag: '#f92672', operator: '#f92672', punct: '#cfcfc2', meta: '#75715e',
    heading: '#e6db74', link: '#66d9ef', labels: '#fd971f',
  },
  'high-contrast': {
    label: 'High contrast', mode: 'dark',
    bg: '#000000', surface: '#0a0a0a', surface2: '#161616', line: '#6b6b6b', fg: '#ffffff', muted: '#d0d0d0',
    accent: '#0b7d73', ink: '#3ff0e0', accent2: '#9fb0ff', onAccent: '#ffffff', ok: '#4dff88', warn: '#ffd000', bad: '#ff4d4d',
    gutter: '#b0b0b0', activeLine: 'rgba(255, 255, 255, .08)', selection: 'rgba(63, 240, 224, .38)', match: 'rgba(255, 208, 0, .25)',
    matchStrong: 'rgba(255, 208, 0, .5)', whitespace: 'rgba(255, 255, 255, .5)',
    comment: '#9ee89e', keyword: '#9fb0ff', control: '#ff9cf0', string: '#ffd88a', escape: '#ffb000', regexp: '#ffb000', number: '#ff9f6b',
    constant: '#ff9f6b', function: '#3ff0e0', builtin: '#7fe0ff', type: '#ffe066', class: '#ffe066', namespace: '#c8ff80', def: '#ffffff',
    property: '#9fd8ff', attribute: '#c8ff80', variable: '#ffffff', tag: '#3ff0e0', operator: '#ffffff', punct: '#e0e0e0', meta: '#ff9cf0',
    heading: '#3ff0e0', link: '#9fb0ff', labels: '#ffb000',
  },
};

export const DEFAULT_DARK = 'nss-dark';
export const DEFAULT_LIGHT = 'nss-light';

// Old names (0.0.1 stored theme "dark" / "light").
const ALIAS = { dark: 'nss-dark', light: 'nss-light' };

// All themes: built-in first, then the user's (custom ones may override a built-in id).
export function allThemes(custom = {}) {
  const out = { ...BUILTIN };
  for (const [id, t] of Object.entries(custom || {})) if (t && typeof t === 'object' && !Array.isArray(t)) out[id] = { ...t, custom: true };
  return out;
}

// Resolves a theme id to a complete colour map (base chain + fallbacks).
export function resolveTheme(id, custom = {}, seen = new Set()) {
  id = ALIAS[id] || id;
  const all = allThemes(custom);
  const t = all[id] || BUILTIN[DEFAULT_DARK];
  if (seen.has(id)) return { ...BUILTIN[DEFAULT_DARK] };
  seen.add(id);
  const base = t.custom ? resolveTheme(typeof t.base === 'string' ? t.base : DEFAULT_DARK, custom, seen) : {};
  const out = { ...base, ...t };
  for (const k of COLOR_KEYS) if (out[k] == null || typeof out[k] !== 'string') out[k] = out[FALLBACK[k]] || BUILTIN[DEFAULT_DARK][k];
  if (out.mode !== 'light' && out.mode !== 'dark') out.mode = base.mode || 'dark';
  out.id = id;
  return out;
}

// Which theme the settings ask for right now ("system" follows the OS).
export function themeIdFor(settings, prefersLight = matchMedia('(prefers-color-scheme: light)').matches) {
  const t = settings.theme;
  if (t === 'system') return prefersLight ? settings.themeLight || DEFAULT_LIGHT : settings.themeDark || DEFAULT_DARK;
  return ALIAS[t] || t || DEFAULT_DARK;
}

const kebab = (s) => s.replace(/[A-Z0-9]+/g, (m) => '-' + m.toLowerCase());

// Writes the theme into CSS variables on <html>. opacity < 1 makes the window
// background see-through (desktop, with a compositor such as picom).
export function applyTheme(root, theme, opacity = 1) {
  const set = (k, v) => root.style.setProperty(k, v);
  const a = Math.max(0.2, Math.min(1, Number(opacity) || 1));
  for (const k of COLOR_KEYS) {
    let v = theme[k];
    if (a < 1 && (k === 'bg' || k === 'surface' || k === 'surface2')) v = rgba(v, k === 'bg' ? a : Math.min(1, a + 0.08));
    if (UI_KEYS.has(k)) set(k === 'surface2' ? '--nss-surface-2' : k === 'accent2' ? '--nss-accent-2' : '--nss-' + kebab(k), v);
    else if (ED_KEYS.has(k)) set('--ed-' + kebab(k), v);
    else set('--syn-' + k, v);
  }
  const light = theme.mode === 'light';
  set('--nss-grid', rgba(theme.accent, light ? 0.1 : 0.09));
  set('--nss-glow', rgba(theme.accent, light ? 0.12 : 0.22));
  set('--nss-shadow', light ? '0 1px 2px rgba(15, 30, 28, .06), 0 8px 24px -10px rgba(15, 30, 28, .18)' : '0 1px 2px rgba(0, 0, 0, .4), 0 8px 28px -12px rgba(0, 0, 0, .6)');
  set('--nss-scrim', light ? 'rgba(10, 20, 18, .4)' : 'rgba(3, 6, 8, .6)');
  set('color-scheme', light ? 'light' : 'dark');
  root.dataset.theme = light ? 'light' : 'dark';
  root.dataset.themeId = theme.id;
  root.classList.toggle('see-through', a < 1);
}

// The colours shown in the editor for a custom theme: resolved, as #rrggbb where
// possible (colour inputs only take hex).
export function hexOrNull(v) {
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : /^#[0-9a-f]{3}$/i.test(v) ? '#' + [...v.slice(1)].map((c) => c + c).join('').toLowerCase() : null;
}

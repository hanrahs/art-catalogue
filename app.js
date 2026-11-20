'use strict';
/* Art Catalogue
 * Plain JavaScript, no frameworks. All details and photos are stored in IndexedDB
 * on this device. A backup is one zip file (data + photos) sent to OneDrive through
 * Android's share menu; the laptop opens that file to view the catalogue.
 */

const APP_VERSION = '1.0.2';

/* =========================================================================
 * Helpers
 * ========================================================================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const cmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
const plural = (n, w) => `${n.toLocaleString()} ${n === 1 ? w : w + 's'}`;
const h = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const isoDate = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const todayText = () => new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = t => t ? new Date(+t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : 'never';
const fmtBytes = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
const parseMoney = s => { const v = parseFloat(String(s ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(v) ? v : null; };
const money = n => n == null || n === '' ? '' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
const surname = n => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] + ' ' + p.slice(0, -1).join(' ') : p[0] || ''; };
const isTouch = () => matchMedia('(pointer: coarse)').matches;

// Turns free-text dates ("Mar 2014", "14/3/2014", "c. 1950") into a number for sorting.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function dateKey(s) {
  s = norm(s);
  if (!s) return null;
  let m;
  if ((m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) return +m[1] * 1e4 + +m[2] * 100 + +m[3];
  if ((m = s.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/))) return +m[3] * 1e4 + +m[2] * 100 + +m[1];
  if ((m = s.match(/\b(\d{1,2})[/.](\d{4})/))) return +m[2] * 1e4 + +m[1] * 100;
  const y = s.match(/\d{4}/);
  if (!y) return null;
  const mi = MONTHS.findIndex(mm => new RegExp('\\b' + mm).test(s));
  return +y[0] * 1e4 + (mi >= 0 ? (mi + 1) * 100 : 0);
}

const ICON = {
  search: '<svg viewBox="0 0 24 24"><path d="M10 2a8 8 0 0 1 6.3 12.9l5.4 5.4-1.4 1.4-5.4-5.4A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>',
  image: '<svg viewBox="0 0 24 24"><path d="M3 4h18v16H3zM5 6v12h14V6zm2 10 3-4 2 2.5 3-4.5 3 6z"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M6 2h8l6 6v14H6zm7 1.5V9h5.5zM8 13v2h8v-2zm0 4v2h8v-2z"/></svg>',
  paste: '<svg viewBox="0 0 24 24"><path d="M9 2h6v2h4v18H5V4h4zm0 4H7v14h10V6h-2v2H9zm2-2v2h2V4z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M18 2a3 3 0 1 1-2.3 4.9L8.9 10.6a3 3 0 0 1 0 2.8l6.8 3.7A3 3 0 1 1 15 19l-7-3.8a3 3 0 1 1 0-6.4l7-3.8A3 3 0 0 1 18 2z"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>',
};

/* =========================================================================
 * Storage (IndexedDB): works, photos (images + PDFs), artists
 * ========================================================================= */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('art-catalogue', 1);
      r.onupgradeneeded = () => { for (const s of ['works', 'photos', 'artists']) r.result.createObjectStore(s, { keyPath: 'id' }); };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  wrap: r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  get(s, id) { return this.wrap(this.db.transaction(s).objectStore(s).get(id)); },
  all(s) { return this.wrap(this.db.transaction(s).objectStore(s).getAll()); },
  keys(s) { return this.wrap(this.db.transaction(s).objectStore(s).getAllKeys()); },
  write(s, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(s, 'readwrite');
      fn(t.objectStore(s));
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Saving failed — the phone may be out of space'));
    });
  },
  put(s, v) { return this.write(s, st => st.put(v)); },
  putMany(s, vs) { return vs.length ? this.write(s, st => vs.forEach(v => st.put(v))) : Promise.resolve(); },
  del(s, ids) { ids = [].concat(ids).filter(Boolean); return ids.length ? this.write(s, st => ids.forEach(id => st.delete(id))) : Promise.resolve(); },
  clear(s) { return this.write(s, st => st.clear()); },
};

const LS = {
  get: (k, d = null) => localStorage.getItem(k) ?? d,
  set: (k, v) => v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v),
  json: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  setJson: (k, v) => v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)),
};

const settings = {
  get changes() { return +LS.get('changes', 0); },
  set changes(v) { LS.set('changes', v); },
  // Editing is on by default on the phone, off on the laptop (which just views backups).
  get canEdit() { const v = LS.get('canEdit'); return v == null ? isTouch() : v === '1'; },
  set canEdit(v) { LS.set('canEdit', v ? '1' : '0'); },
};
function touched() { settings.changes = settings.changes + 1; }
function requestPersist() {
  if (LS.get('persistAsked')) return;
  LS.set('persistAsked', '1');
  navigator.storage?.persist?.();
}

/* =========================================================================
 * Fields
 * ========================================================================= */
const PRESETS = {
  medium: ['Oil on canvas', 'Oil on linen', 'Oil on board', 'Acrylic on canvas', 'Acrylic on paper', 'Watercolour', 'Gouache',
    'Ink', 'Pencil', 'Charcoal', 'Pastel', 'Mixed media', 'Screenprint', 'Etching', 'Lithograph', 'Woodcut', 'Linocut',
    'Giclée print', 'Photograph', 'Ceramic', 'Glass', 'Sculpture', 'Textile'],
  frameCondition: ['Excellent', 'Good', 'Fair', 'Poor', 'Restored'],
};

// only: which gallery shows the field in the form ('mine' / 'liked'); omitted = both.
// Fields hidden from a gallery's form are still shown on its detail page if they have a value
// (e.g. a size pasted from a gallery label onto a Liked work).
const SECTIONS = [
  { fields: [
    { k: 'title', label: 'Title' },
    { k: 'artist', label: 'Artist', list: true },
    { k: 'year', label: 'Year made', ph: 'e.g. 1998 or c. 1950', half: true },
    { k: 'medium', label: 'Medium', list: true, ph: 'Choose or type', half: true },
    { k: 'size', label: 'Size', type: 'size', only: 'mine' },
    { k: 'series', label: 'Collection / series', list: true, only: 'mine' },
  ] },
  { title: 'Where seen', only: 'liked', fields: [
    { k: 'seenAt', label: 'Where', dlabel: 'Seen at', list: true, ph: 'Gallery, museum, city…' },
    { k: 'seenWhen', label: 'When', dlabel: 'Seen', ph: 'e.g. Nov 2026' },
  ] },
  { title: 'Frame', only: 'mine', fields: [
    { k: 'frameType', label: 'Type', dlabel: 'Frame', ph: 'e.g. Box frame', third: true },
    { k: 'frameMaterial', label: 'Material', dlabel: 'Frame material', ph: 'e.g. Oak', third: true },
    { k: 'frameCondition', label: 'Condition', dlabel: 'Frame condition', list: true, third: true },
  ] },
  { title: 'Acquisition', only: 'mine', fields: [
    { k: 'acquired', label: 'When', dlabel: 'Acquired', ph: 'e.g. Mar 2014', half: true },
    { k: 'price', label: 'Price paid', type: 'money', half: true },
    { k: 'source', label: 'Where bought', dlabel: 'Bought from', list: true, ph: 'Gallery, auction, the artist…' },
    { k: 'seller', label: 'Seller', list: true, half: true },
    { k: 'sellerLocation', label: 'Seller location', list: true, half: true },
  ] },
  { title: 'Value', only: 'mine', fields: [
    { k: 'value', label: 'Current value', dlabel: 'Value', type: 'money', half: true },
    { k: 'valuedOn', label: 'Valued when', dlabel: 'Valued', ph: 'e.g. 2024, insurance', half: true },
  ] },
  { title: 'Notes', fields: [
    { k: 'description', label: 'Description', type: 'area', only: 'mine' },
    { k: 'notes', label: 'Notes', type: 'area' },
    { k: 'story', label: 'Stories', type: 'area', only: 'mine' },
    { k: 'tags', label: 'Tags', type: 'tags', only: 'mine', ph: 'Separate with commas' },
    { k: 'links', label: 'Links', type: 'links', ph: 'One web address per line' },
  ] },
];
const ALL_FIELDS = SECTIONS.flatMap(s => s.fields.map(f => ({ ...f, only: f.only || s.only })));
const TEXT_BLOCKS = ['description', 'notes', 'story'];
const shows = (x, g) => !x.only || x.only === g;
const UNITS = ['cm', 'mm', 'in'];

function fmtSize(w) {
  const p = [w.sizeH, w.sizeW, w.sizeD].map(v => String(v ?? '').trim()).filter(Boolean);
  return p.length ? `${p.join(' × ')} ${w.unit || 'cm'}` : '';
}
function fmtField(f, w) {
  if (f.type === 'size') return fmtSize(w);
  if (f.type === 'money') return money(w[f.k]);
  if (f.type === 'tags') return (w.tags || []).join(', ');
  return w[f.k] ?? '';
}
const linkList = s => String(s || '').split(/\s*\n\s*|\s+(?=https?:)/).map(l => l.trim()).filter(Boolean)
  .map(l => /^[a-z]+:/i.test(l) ? l : 'https://' + l);

/* =========================================================================
 * State
 * ========================================================================= */
const S = {
  works: [],
  artists: new Map(), // key -> { id, name, life, bio, links, docs }
  tab: 'mine',
  q: { mine: '', liked: '', artists: '' },
  sort: { mine: LS.get('sort-mine', 'added'), liked: LS.get('sort-liked', 'added') },
};
const byId = id => S.works.find(w => w.id === id);
const akey = name => norm(name);

function prep(w) {
  w.photos ||= []; w.docs ||= [];
  w._hay = norm([...ALL_FIELDS.map(f => fmtField(f, w)), w.label].join(' '));
  return w;
}
function clean(w) {
  const o = {};
  for (const [k, v] of Object.entries(w)) if (!k.startsWith('_') && v !== '' && v != null) o[k] = v;
  return o;
}
function upsertWork(w) {
  prep(w);
  const i = S.works.findIndex(x => x.id === w.id);
  if (i >= 0) S.works[i] = w; else S.works.push(w);
}
async function loadState() {
  S.works = (await DB.all('works')).map(prep);
  S.artists = new Map((await DB.all('artists')).map(a => [a.id, a]));
}

// Every artist that has a record or appears on any work.
function allArtists() {
  const m = new Map();
  for (const a of S.artists.values()) m.set(a.id, { id: a.id, name: a.name, rec: a, works: [] });
  for (const w of S.works) {
    const k = akey(w.artist);
    if (!k) continue;
    if (!m.has(k)) m.set(k, { id: k, name: w.artist.trim(), rec: null, works: [] });
    m.get(k).works.push(w);
  }
  return [...m.values()];
}
// Artists ordered by most recently used, for quick suggestions.
function recentArtists() {
  const seen = new Map();
  for (const w of [...S.works].sort((a, b) => b.created - a.created)) {
    const k = akey(w.artist);
    if (k && !seen.has(k)) seen.set(k, w.artist.trim());
  }
  return [...seen.values()];
}
function suggestions(k) {
  const m = new Map();
  const add = v => { v = String(v ?? '').trim(); if (v && !m.has(norm(v))) m.set(norm(v), v); };
  (PRESETS[k] || []).forEach(add);
  if (k === 'artist') allArtists().forEach(a => add(a.name));
  else S.works.forEach(w => add(w[k]));
  return [...m.values()].sort(cmp);
}
function allTags() {
  const m = new Map();
  S.works.forEach(w => (w.tags || []).forEach(t => m.has(norm(t)) || m.set(norm(t), t)));
  return [...m.values()].sort(cmp);
}

/* =========================================================================
 * Photos
 * ========================================================================= */
async function toJpeg(bmp, max, q) {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', q));
}
// Saves a photo (resized) or a PDF into the photos store and returns its record.
async function storeFile(file, max = 2000) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const p = { id: uid(), kind: 'pdf', blob: new Blob([await file.arrayBuffer()], { type: 'application/pdf' }), name: file.name };
    await DB.put('photos', p);
    return p;
  }
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch { throw new Error(`Couldn’t read ${file.name || 'that photo'} — try a JPEG or PNG`); }
  const p = { id: uid(), kind: 'image', w: bmp.width, h: bmp.height, name: file.name,
    blob: await toJpeg(bmp, max, 0.86), thumb: await toJpeg(bmp, 480, 0.8) };
  bmp.close();
  await DB.put('photos', p);
  return p;
}

const urls = new Map(); // `${id}:f|t` -> { kind, url, name }
async function photoInfo(id, full) {
  const key = id + (full ? ':f' : ':t');
  if (urls.has(key)) return urls.get(key);
  const p = await DB.get('photos', id);
  const info = !p ? { kind: 'missing' }
    : p.kind === 'pdf' ? { kind: 'pdf', name: p.name }
    : { kind: 'image', url: URL.createObjectURL(full ? p.blob : (p.thumb || p.blob)) };
  urls.set(key, info);
  return info;
}
function forget(id) {
  for (const k of [id + ':f', id + ':t']) { const i = urls.get(k); if (i?.url) URL.revokeObjectURL(i.url); urls.delete(k); }
}
async function loadImg(img) {
  const info = await photoInfo(img.dataset.photo, img.dataset.full === '1');
  if (info.kind === 'image') img.src = info.url;
  else img.replaceWith(h(`<div class="pdf"><b>${info.kind === 'pdf' ? 'PDF' : '?'}</b><span>${esc(info.name || '')}</span></div>`));
}
const io = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { io.unobserve(e.target); loadImg(e.target); }
}), { rootMargin: '600px' });
function hydrate(root) { $$('img[data-photo]:not([src])', root).forEach(i => io.observe(i)); }

async function coverRatio(ids) {
  const p = ids[0] && await DB.get('photos', ids[0]);
  return p?.w ? +(p.w / p.h).toFixed(3) : 1;
}

function pickFiles(kind) {
  return new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file'; i.hidden = true;
    i.accept = kind === 'backup' ? '.zip,.txt,application/zip,text/plain' : kind === 'file' ? 'image/*,application/pdf' : 'image/*';
    if (kind === 'camera') i.capture = 'environment';
    if (kind === 'gallery' || kind === 'file') i.multiple = true;
    i.addEventListener('change', () => { res([...i.files]); i.remove(); });
    i.addEventListener('cancel', () => { res([]); i.remove(); });
    document.body.appendChild(i);
    i.click();
  });
}

// A list of photos/documents being edited. New files are stored straight away (so
// nothing is lost if the phone reloads the app); they're deleted again on cancel.
class PhotoSet {
  constructor(st = {}, { cover = false, docs = false } = {}) {
    this.ids = [...(st.ids || [])]; this.added = [...(st.added || [])]; this.removed = [...(st.removed || [])];
    this.cover = cover; this.docs = docs;
  }
  state() { return { ids: this.ids, added: this.added, removed: this.removed }; }
  html() {
    const tiles = this.ids.map((id, i) => `<div class="pt" data-pid="${id}"><img data-photo="${id}" alt="">`
      + `${this.cover && i === 0 && this.ids.length > 1 ? '<span class="badge">Cover</span>' : ''}`
      + `<button type="button" class="x" data-x aria-label="Remove">×</button></div>`).join('');
    return `${tiles ? `<div class="strip">${tiles}</div>` : ''}
      <div class="addrow">
        <button type="button" class="btn" data-pick="camera">${ICON.camera}${this.docs ? 'Photograph' : 'Take photo'}</button>
        <button type="button" class="btn" data-pick="${this.docs ? 'file' : 'gallery'}">${this.docs ? ICON.file + 'Choose file' : ICON.image + 'From gallery'}</button>
      </div>
      ${this.cover && this.ids.length > 1 ? '<p class="hint">Tap a photo to make it the cover.</p>' : ''}`;
  }
  async add(files, max) {
    if (!files.length) return;
    toast(`Adding ${plural(files.length, this.docs ? 'file' : 'photo')}…`, 0);
    for (const f of files) {
      try { const p = await storeFile(f, max); this.ids.push(p.id); this.added.push(p.id); }
      catch (e) { toast(e.message); return; }
    }
    toast('', 1);
  }
  remove(id) {
    this.ids = this.ids.filter(x => x !== id);
    if (this.added.includes(id)) { this.added = this.added.filter(x => x !== id); DB.del('photos', id); forget(id); }
    else this.removed.push(id);
  }
  async discard() { await DB.del('photos', this.added); this.added.forEach(forget); this.added = []; }
  async commit() { await DB.del('photos', this.removed); this.removed.forEach(forget); this.added = []; this.removed = []; }
  wire(container, onChange, getMax = () => 2000) {
    const render = () => { container.innerHTML = this.html(); hydrate(container); };
    container.addEventListener('click', async e => {
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const files = await pickFiles(pick.dataset.pick);
        if (files.length) { await this.add(files, getMax()); render(); onChange(); }
        return;
      }
      const t = e.target.closest('.pt');
      if (!t) return;
      if (e.target.closest('[data-x]')) { this.remove(t.dataset.pid); render(); onChange(); }
      else if (this.cover) { this.ids = [t.dataset.pid, ...this.ids.filter(x => x !== t.dataset.pid)]; render(); onChange(); }
      else openFile(t.dataset.pid, this.ids);
    });
    render();
  }
}

// Opens a document: images in the photo viewer, PDFs in the device's PDF viewer.
async function openFile(id, ids = [id]) {
  const p = await DB.get('photos', id);
  if (!p) return;
  if (p.kind === 'pdf') {
    const file = new File([p.blob], p.name || 'document.pdf', { type: 'application/pdf' });
    if (!isTouch()) { window.open(URL.createObjectURL(file), '_blank'); return; }
    download(file);
    return;
  }
  const images = [];
  for (const x of ids) { const r = await DB.get('photos', x); if (r?.kind !== 'pdf') images.push(x); }
  openViewer(images, Math.max(0, images.indexOf(id)), 'document');
}

/* =========================================================================
 * Layers (pages and dialogs) — each one is a browser history entry, so the
 * Android back button closes the top one.
 * ========================================================================= */
const stack = [];
function pushLayer(el, opts = {}) {
  const layer = { el, ...opts };
  stack.push(layer);
  document.body.appendChild(el);
  document.body.classList.add('layered');
  history.pushState({ layer: stack.length }, '');
  return layer;
}
function closeTop(force = false) {
  const layer = stack[stack.length - 1];
  if (!layer) return Promise.resolve();
  if (force) layer.forced = true;
  return new Promise(res => { layer.closed = res; history.back(); });
}
window.addEventListener('popstate', () => {
  const layer = stack[stack.length - 1];
  if (!layer) { if (history.state?.layer) history.back(); return; }
  if (!layer.forced && layer.isDirty?.()) {
    history.pushState({ layer: stack.length }, '');
    confirmDlg('Discard changes?', 'What you’ve entered here hasn’t been saved.', 'Discard', true)
      .then(ok => ok && closeTop(true));
    return;
  }
  stack.pop();
  layer.el.remove();
  if (!stack.length) document.body.classList.remove('layered');
  layer.onClose?.();
  layer.closed?.();
  if (!stack.length && updateReady) setTimeout(() => location.reload(), 300);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) closeTop(); });
function refreshLayers() { stack.forEach(l => l.refresh?.()); }
function refreshAll() { renderTab(); refreshLayers(); }

// Dialog. build(el, done) wires the buttons; done(value) closes it and resolves.
function modal(html, build) {
  return new Promise(res => {
    const el = h(`<div class="layer modal"><div class="sheet">${html}</div></div>`);
    const layer = pushLayer(el, { onClose: () => res(layer.result) });
    el.addEventListener('click', e => { if (e.target === el) closeTop(); });
    const done = v => { layer.result = v; closeTop(); };
    $$('[data-v]', el).forEach(b => b.addEventListener('click', () => done(b.dataset.v)));
    build?.(el, done);
    $('input, textarea', el)?.focus();
  });
}
async function confirmDlg(title, text, okLabel = 'OK', danger = false) {
  const v = await modal(`<h3>${esc(title)}</h3><p>${esc(text)}</p>
    <div class="btns"><button class="btn" data-v="">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(okLabel)}</button></div>`);
  return v === '1';
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  clearTimeout(toastTimer);
  if (!msg) { t.hidden = true; return; }
  t.textContent = msg;
  t.hidden = false;
  if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function download(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
async function shareOrDownload(file) {
  if (isTouch() && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: file.name }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  download(file);
  return 'downloaded';
}

/* =========================================================================
 * Tabs
 * ========================================================================= */
function switchTab(tab) {
  S.tab = tab;
  LS.set('tab', tab);
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $$('main > .view').forEach(v => { v.hidden = v.id !== 'v-' + tab; });
  renderTab();
  window.scrollTo(0, 0);
}
function renderTab() {
  document.body.classList.toggle('ro', !settings.canEdit);
  if (S.tab === 'mine' || S.tab === 'liked') renderGallery(S.tab);
  else if (S.tab === 'artists') renderArtists();
  else renderMore();
}

/* =========================================================================
 * Gallery tabs (My collection, Liked)
 * ========================================================================= */
const byNum = (get, dir) => (a, b) => {
  const x = get(a), y = get(b);
  if (x == null && y == null) return b.created - a.created;
  if (x == null) return 1;
  if (y == null) return -1;
  return (x - y) * dir || b.created - a.created;
};
const SORTS = {
  added: { label: 'Recently added', fn: (a, b) => b.created - a.created },
  artist: { label: 'Artist', fn: (a, b) => cmp(surname(a.artist), surname(b.artist)) || cmp(a.title, b.title) },
  title: { label: 'Title', fn: (a, b) => cmp(a.title, b.title) },
  year: { label: 'Year', fn: byNum(w => dateKey(w.year), 1) },
  acquired: { label: 'Acquired', only: 'mine', fn: byNum(w => dateKey(w.acquired), -1) },
  value: { label: 'Value', only: 'mine', fn: byNum(w => w.value ?? null, -1) },
  seen: { label: 'Seen', only: 'liked', fn: byNum(w => dateKey(w.seenWhen), -1) },
};
const sortFor = g => { const s = SORTS[S.sort[g]]; return s && shows(s, g) ? S.sort[g] : 'added'; };

function filteredWorks(g, q = S.q[g]) {
  const terms = norm(q).split(' ').filter(Boolean);
  return S.works.filter(w => w.gallery === g && terms.every(t => w._hay.includes(t))).sort(SORTS[sortFor(g)].fn);
}

function cardHtml(w) {
  const r = Math.min(2, Math.max(0.5, w.ratio || 1)).toFixed(3);
  return `<div class="card" data-id="${w.id}" style="--r:${r}" role="button" tabindex="0">
    <div class="img">${w.photos[0] ? `<img data-photo="${w.photos[0]}" alt="">` : `<div class="noimg">${esc((w.title || w.artist || '?').slice(0, 1))}</div>`}</div>
    <div class="cap"><b>${esc(w.title || 'Untitled')}</b><span>${esc(w.artist || '')}</span></div></div>`;
}

function buildGallery(g) {
  const sec = $('#v-' + g);
  sec.innerHTML = `<div class="wrap">
      <div class="top"><h1>${g === 'mine' ? 'My collection' : 'Liked'}</h1><span class="count"></span></div>
      <div class="banners"></div>
      <label class="search">${ICON.search}<input type="search" placeholder="Search title, artist, medium…" autocomplete="off" spellcheck="false"></label>
      <div class="chips">${Object.entries(SORTS).filter(([, s]) => shows(s, g)).map(([k, s]) => `<button class="chip" data-sort="${k}">${s.label}</button>`).join('')}</div>
      <div class="summary"></div>
      <div class="grid"></div>
      <div class="empty"></div>
    </div>
    <button class="fab edit-only" aria-label="Add">+</button>`;
  const q = $('input', sec);
  q.value = S.q[g];
  q.addEventListener('input', () => { S.q[g] = q.value; renderGallery(g); });
  $('.chips', sec).addEventListener('click', e => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    S.sort[g] = b.dataset.sort;
    LS.set('sort-' + g, b.dataset.sort);
    renderGallery(g);
  });
  const grid = $('.grid', sec);
  grid.addEventListener('click', e => { const c = e.target.closest('.card'); if (c) openDetail(c.dataset.id); });
  grid.addEventListener('keydown', e => { const c = e.target.closest('.card'); if (c && e.key === 'Enter') openDetail(c.dataset.id); });
  $('.fab', sec).addEventListener('click', () => g === 'liked' ? openQuick('liked') : addMenu());
  $('.banners', sec).addEventListener('click', bannerClick);
  sec.dataset.built = '1';
}

function renderGallery(g) {
  const sec = $('#v-' + g);
  if (!sec.dataset.built) buildGallery(g);
  const total = S.works.filter(w => w.gallery === g).length;
  const list = filteredWorks(g);
  $('.count', sec).textContent = list.length === total ? plural(total, 'work') : `${list.length} of ${total}`;
  $$('.chip', sec).forEach(c => c.classList.toggle('on', c.dataset.sort === sortFor(g)));
  const grid = $('.grid', sec);
  grid.innerHTML = list.map(cardHtml).join('');
  hydrate(grid);
  let sum = '';
  if (g === 'mine') {
    const valued = list.filter(w => w.value != null);
    if (valued.length) sum = `Total value ${money(valued.reduce((s, w) => s + w.value, 0))}`
      + (valued.length < list.length ? ` <span>(${valued.length} of ${list.length} valued)</span>` : '');
  }
  $('.summary', sec).innerHTML = sum;
  $('.empty', sec).innerHTML = total && !list.length ? 'Nothing matches your search.'
    : total ? ''
    : !settings.canEdit ? ''
    : g === 'mine' ? 'Nothing here yet. Tap <b>+</b> to add your first artwork — take a photo or choose one from your gallery.'
    : 'Keep track of art you love — in galleries, at exhibitions, at friends’ places. Tap <b>+</b> to start a quick capture.';
  $('.banners', sec).innerHTML = bannersHtml();
}

function bannersHtml() {
  if (!settings.canEdit) {
    const lb = LS.get('loadedBackup');
    return S.works.length || lb
      ? `<div class="banner">Viewing a backup${lb ? ' from ' + fmtTime(lb) : ''}. <button class="link" data-go="restore">Open a newer one</button></div>`
      : `<div class="banner">To view your catalogue on this device, open your latest backup file from OneDrive. <button class="link" data-go="restore">Open backup…</button></div>`;
  }
  const n = settings.changes;
  if (n > 0 && (Date.now() - +LS.get('lastBackup', 0) > 2 * 864e5 || n >= 15))
    return `<div class="banner">${plural(n, 'change')} since your last backup. <button class="link" data-go="backup">Back up now</button></div>`;
  return '';
}
function bannerClick(e) {
  const go = e.target.closest('[data-go]')?.dataset.go;
  if (go === 'backup') doBackup();
  if (go === 'restore') doRestore();
}

async function addMenu() {
  const v = await modal(`<h3>Add to My collection</h3>
    <div class="btns col">
      <button class="btn primary" data-v="full">Add an artwork<small>All the details</small></button>
      <button class="btn" data-v="quick">Quick capture<small>Photo, artist and title — several in a row</small></button>
      <button class="btn link" data-v="">Cancel</button>
    </div>`);
  if (v === 'full') openEditor({ gallery: 'mine' });
  if (v === 'quick') openQuick('mine');
}

/* =========================================================================
 * Artwork detail
 * ========================================================================= */
function openDetail(id) {
  const el = h(`<div class="layer page"><div class="pagebar"><button class="ic" data-a="back" aria-label="Back">←</button>
    <span class="pb-title"></span><button class="txt edit-only" data-a="edit">Edit</button></div><div class="scroll"></div></div>`);
  const render = () => {
    const w = byId(id);
    if (!w) { if (stack[stack.length - 1] === layer) closeTop(true); return; }
    const sc = $('.scroll', el), top = sc.scrollTop;
    sc.innerHTML = detailHtml(w);
    sc.scrollTop = top;
    hydrate(sc);
    $$('.hero img', el).forEach(loadImg);
    const track = $('.carousel', el), dots = $$('.dots i', el);
    track?.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      dots.forEach((d, j) => d.classList.toggle('on', i === j));
    }, { passive: true });
  };
  const layer = pushLayer(el, { refresh: render });
  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    const w = byId(id);
    if (!a || !w) return;
    if (a === 'back') closeTop();
    else if (a === 'edit') openEditor({ id });
    else if (a === 'photo') openViewer(w.photos, +e.target.closest('[data-i]').dataset.i, [w.artist, w.title].filter(Boolean).join(' - ') || 'artwork');
    else if (a === 'doc') openFile(e.target.closest('[data-pid]').dataset.pid, w.docs);
    else if (a === 'artist') openArtist(akey(w.artist));
    else if (a === 'tag') { closeTop(); S.q.mine = e.target.closest('[data-tag]').dataset.tag; $('#v-mine input') && ($('#v-mine input').value = S.q.mine); switchTab('mine'); }
    else if (a === 'bought') {
      if (!await confirmDlg('Move to My collection?', 'Great find! This moves it from Liked to My collection, keeping everything you’ve entered. You can then add the purchase details.', 'Move')) return;
      w.gallery = 'mine'; w.updated = Date.now();
      await DB.put('works', clean(w)); upsertWork(w); touched();
      refreshAll();
      openEditor({ id });
    }
  });
  render();
}

function detailHtml(w) {
  const artist = w.artist ? (S.artists.get(akey(w.artist)) || {}) : {};
  const hero = w.photos.length ? `<div class="hero"><div class="carousel">${w.photos.map((p, i) =>
      `<div class="slide" data-a="photo" data-i="${i}"><img data-photo="${p}" data-full="1" alt=""></div>`).join('')}</div>
      ${w.photos.length > 1 ? `<div class="dots">${w.photos.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}</div>`
    : '';
  const facts = [];
  for (const f of ALL_FIELDS) {
    if (['title', 'artist', 'year', 'tags', 'links', ...TEXT_BLOCKS].includes(f.k)) continue;
    const v = fmtField(f, w);
    if (v) facts.push(`<dt>${esc(f.dlabel || f.label)}</dt><dd>${esc(v)}</dd>`);
  }
  const blocks = TEXT_BLOCKS.filter(k => w[k]).map(k =>
    `<div class="note"><h4>${esc(ALL_FIELDS.find(f => f.k === k).label)}</h4><div class="pre">${esc(w[k])}</div></div>`).join('');
  const tags = (w.tags || []).length ? `<div class="tags">${w.tags.map(t => `<button class="chip" data-a="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : '';
  const links = linkList(w.links);
  return `<div class="dwrap">${hero}<div class="dinfo">
    <div class="label">
      ${w.artist ? `<button class="artist" data-a="artist">${esc(w.artist)}${artist.life ? ` <small>(${esc(artist.life)})</small>` : ''}</button>` : ''}
      <h2>${esc(w.title || 'Untitled')}</h2>
      ${w.year ? `<div class="yr">${esc(w.year)}</div>` : ''}
    </div>
    ${facts.length ? `<dl class="facts">${facts.join('')}</dl>` : ''}
    ${blocks}${tags}
    ${links.length ? `<div class="note"><h4>Links</h4>${links.map(l => `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l.replace(/^https?:\/\/(www\.)?/, ''))}</a>`).join('')}</div>` : ''}
    ${w.docs.length ? `<div class="note"><h4>Certificates &amp; receipts</h4><div class="strip">${w.docs.map(d =>
      `<div class="pt" data-a="doc" data-pid="${d}"><img data-photo="${d}" alt=""></div>`).join('')}</div></div>` : ''}
    ${w.label ? `<details class="note"><summary><h4>Label text</h4></summary><div class="pre">${esc(w.label)}</div></details>` : ''}
    ${w.gallery === 'liked' ? '<button class="btn wide edit-only" data-a="bought">I bought it — move to My collection</button>' : ''}
    <p class="meta">Added ${fmtTime(w.created)}${w.updated && w.updated - w.created > 6e4 ? ' · edited ' + fmtTime(w.updated) : ''}</p>
  </div></div>`;
}

/* Full-screen photo viewer (swipe between photos, pinch to zoom, share) */
function openViewer(ids, start = 0, name = 'photo') {
  if (!ids.length) return;
  const el = h(`<div class="layer viewer"><div class="vbar"><button class="ic" data-a="back" aria-label="Close">✕</button>
    <span class="vcount"></span><button class="ic" data-a="share" aria-label="Share">${ICON.share}</button></div>
    <div class="vtrack">${ids.map(id => `<div class="vslide"><img data-photo="${id}" data-full="1" alt=""></div>`).join('')}</div></div>`);
  pushLayer(el);
  const track = $('.vtrack', el);
  $$('img', el).forEach(loadImg);
  const idx = () => Math.round(track.scrollLeft / track.clientWidth);
  const upd = () => { $('.vcount', el).textContent = ids.length > 1 ? `${idx() + 1} / ${ids.length}` : ''; };
  requestAnimationFrame(() => { track.scrollLeft = start * track.clientWidth; upd(); });
  track.addEventListener('scroll', upd, { passive: true });
  el.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'back') closeTop();
    if (a === 'share') {
      const p = await DB.get('photos', ids[idx()]);
      if (p) shareOrDownload(new File([p.blob], `${name.replace(/[\\/:*?"<>|]/g, '')}.jpg`, { type: 'image/jpeg' }));
    }
  });
}

/* =========================================================================
 * Editor (add / edit an artwork)
 * ========================================================================= */
function fieldHtml(f, w) {
  const id = 'f-' + f.k, v = w[f.k] ?? '';
  let input;
  if (f.type === 'area') input = `<textarea id="${id}" name="${f.k}" rows="3" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
  else if (f.type === 'links') input = `<textarea id="${id}" name="${f.k}" rows="2" placeholder="${esc(f.ph || '')}" autocapitalize="off" spellcheck="false">${esc(v)}</textarea>`;
  else if (f.type === 'size') input = `<div class="sizerow">
      <input name="sizeH" inputmode="decimal" placeholder="Height" value="${esc(w.sizeH ?? '')}"><span>×</span>
      <input name="sizeW" inputmode="decimal" placeholder="Width" value="${esc(w.sizeW ?? '')}"><span>×</span>
      <input name="sizeD" inputmode="decimal" placeholder="Depth" value="${esc(w.sizeD ?? '')}">
      <select name="unit">${UNITS.map(u => `<option${(w.unit || 'cm') === u ? ' selected' : ''}>${u}</option>`).join('')}</select></div>`;
  else if (f.type === 'tags') {
    const tags = allTags();
    input = `<input id="${id}" name="tags" value="${esc((w.tags || []).join(', '))}" placeholder="${esc(f.ph || '')}">
      ${tags.length ? `<div class="tagpick">${tags.map(t => `<button type="button" class="chip" data-addtag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}`;
  }
  else if (f.type === 'money') input = `<input id="${id}" name="${f.k}" inputmode="decimal" placeholder="$" value="${v === '' ? '' : esc(v)}">`;
  else input = `<input id="${id}" name="${f.k}" value="${esc(v)}" placeholder="${esc(f.ph || '')}"${f.list ? ` list="dl-${f.k}"` : ''}${f.k === 'title' || f.k === 'artist' ? ' autocapitalize="words"' : ''}>`;
  return `<div class="fld${f.half ? ' half' : ''}${f.third ? ' third' : ''}"><label for="${id}">${esc(f.label)}</label>${input}</div>`;
}
function fieldsHtml(w) {
  const lists = ALL_FIELDS.filter(f => f.list && shows(f, w.gallery))
    .map(f => `<datalist id="dl-${f.k}">${suggestions(f.k).map(s => `<option value="${esc(s)}">`).join('')}</datalist>`).join('');
  return SECTIONS.filter(s => shows(s, w.gallery)).map(s => `<fieldset>${s.title ? `<legend>${s.title}</legend>` : ''}
    <div class="fgrid">${s.fields.filter(f => shows(f, w.gallery)).map(f => fieldHtml(f, w)).join('')}</div></fieldset>`).join('') + lists;
}
function readFields(form, w) {
  for (const f of ALL_FIELDS) {
    if (!shows(f, w.gallery)) continue;
    if (f.type === 'size') { for (const k of ['sizeH', 'sizeW', 'sizeD', 'unit']) w[k] = form.elements[k].value.trim(); continue; }
    const el = form.elements[f.k];
    if (!el) continue;
    const v = el.value;
    w[f.k] = f.type === 'tags' ? v.split(',').map(s => s.trim()).filter(Boolean)
      : f.type === 'money' ? parseMoney(v)
      : v.trim();
  }
}

function openEditor({ id, gallery = 'mine', draft } = {}) {
  if (!settings.canEdit) return;
  const orig = draft ? (draft.isNew ? null : byId(draft.w.id)) : id ? byId(id) : null;
  if (draft && !draft.isNew && !orig) { LS.set('draft', null); return; }
  const isNew = !orig;
  const w = draft ? draft.w : orig ? JSON.parse(JSON.stringify(clean(orig))) : { id: uid(), gallery, photos: [], docs: [], created: Date.now() };
  const photos = new PhotoSet(draft ? draft.photos : { ids: w.photos }, { cover: true });
  const docs = new PhotoSet(draft ? draft.docs : { ids: w.docs || [] }, { docs: true });
  let dirty = !!draft, saved = false;

  const el = h(`<div class="layer page editor"><div class="pagebar">
      <button class="ic" data-a="back" aria-label="Cancel">✕</button><span class="pb-title">${isNew ? 'New artwork' : 'Edit'}</span>
      <button class="txt" data-a="save">Save</button></div>
    <div class="scroll"><div class="formwrap">
      <div class="seg"><button data-g="mine">My collection</button><button data-g="liked">Liked</button></div>
      <div class="ed-photos"></div>
      <div class="addrow label-row">${lensBtn('subtle')}<button type="button" class="btn subtle" data-a="paste">${ICON.paste}Paste label text</button></div>
      <form class="fields" autocomplete="off" onsubmit="return false"></form>
      <div class="ed-docs"><h3>Certificates &amp; receipts</h3><p class="hint">Photos or PDFs — certificates of authenticity, receipts, valuations.</p><div class="docs"></div></div>
      ${isNew ? '' : '<button class="btn danger wide" data-a="delete">Delete this artwork</button>'}
      <button class="btn primary wide" data-a="save">Save</button>
    </div></div></div>`);
  const form = $('.fields', el);

  const collect = () => { readFields(form, w); w.photos = photos.ids; w.docs = docs.ids; };
  const saveDraft = () => { collect(); LS.setJson('draft', { w: clean(w), photos: photos.state(), docs: docs.state(), isNew }); };
  const changed = () => { dirty = true; saveDraft(); };
  const renderForm = () => {
    $$('.seg button', el).forEach(b => b.classList.toggle('on', b.dataset.g === w.gallery));
    form.innerHTML = fieldsHtml(w);
    $('.ed-docs', el).hidden = w.gallery !== 'mine';
  };
  const maxSize = () => w.gallery === 'liked' ? 1400 : 2000;

  renderForm();
  photos.wire($('.ed-photos', el), changed, maxSize);
  docs.wire($('.docs', el), changed);
  form.addEventListener('input', changed);
  form.addEventListener('click', e => {
    const t = e.target.closest('[data-addtag]');
    if (!t) return;
    const inp = form.elements.tags, cur = inp.value.split(',').map(s => s.trim()).filter(Boolean);
    if (!cur.some(x => norm(x) === norm(t.dataset.addtag))) inp.value = [...cur, t.dataset.addtag].join(', ');
    changed();
  });

  const layer = pushLayer(el, {
    isDirty: () => dirty && !saved,
    onClose: () => { if (!saved) { photos.discard(); docs.discard(); } LS.set('draft', null); },
  });

  el.addEventListener('click', async e => {
    const g = e.target.closest('[data-g]')?.dataset.g;
    if (g && g !== w.gallery) { collect(); w.gallery = g; renderForm(); changed(); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'back') closeTop();
    if (a === 'paste') {
      const text = await pasteLabelDlg();
      if (!text) return;
      collect();
      const p = parseLabel(text);
      for (const k of ['artist', 'title', 'year', 'medium', 'sizeH', 'sizeW', 'sizeD', 'unit']) if (p[k]) w[k] = p[k];
      if (p.price && w.gallery === 'liked' && !w.notes) w.notes = p.price;
      w.label = text;
      if (p.life) saveArtistLife(w.artist, p.life);
      renderForm(); changed();
      toast('Filled in from the label — check it’s right');
    }
    if (a === 'save') {
      collect();
      if (!w.photos.length && !w.title && !w.artist) { toast('Add a photo, title or artist first'); return; }
      try {
        w.updated = Date.now();
        w.ratio = await coverRatio(w.photos);
        await DB.put('works', clean(w));
        await photos.commit(); await docs.commit();
      } catch (err) { toast(err.message || 'Couldn’t save', 5000); return; }
      upsertWork(w); touched(); requestPersist();
      saved = true;
      await closeTop(true);
      refreshAll();
      toast(isNew ? 'Added' : 'Saved');
    }
    if (a === 'delete') {
      if (!await confirmDlg('Delete this artwork?', `“${w.title || 'Untitled'}” and its photos will be removed from this device.`, 'Delete', true)) return;
      await DB.del('works', w.id);
      await DB.del('photos', [...photos.ids, ...photos.removed, ...docs.ids, ...docs.removed]);
      [...photos.ids, ...docs.ids].forEach(forget);
      S.works = S.works.filter(x => x.id !== w.id);
      touched();
      saved = true;
      await closeTop(true);
      refreshAll();
      toast('Deleted');
    }
  });
  if (draft) saveDraft();
  return layer;
}

/* =========================================================================
 * Quick capture — several works in a row, e.g. walking round an exhibition
 * ========================================================================= */
function getVisit() {
  const v = LS.json('visit');
  return v && Date.now() - v.started < 12 * 36e5 ? v : null; // a visit lasts 12 hours
}
async function visitDlg(v) {
  const at = suggestions('seenAt');
  const res = await modal(`<h3>Where are you?</h3>
    <p class="hint">Everything you capture is saved with this place and date.</p>
    <div class="fld"><label for="v-at">Gallery, museum or place</label><input id="v-at" list="dl-visit" value="${esc(v?.at || '')}" autocapitalize="words"></div>
    <datalist id="dl-visit">${at.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    <div class="fld"><label for="v-when">When</label><input id="v-when" value="${esc(v?.when || todayText())}"></div>
    <div class="btns"><button class="btn" data-v="">Skip</button><button class="btn primary" data-a="ok">Start</button></div>`,
  (el, done) => { $('[data-a=ok]', el).onclick = () => done({ at: $('#v-at', el).value.trim(), when: $('#v-when', el).value.trim() }); });
  if (!res) return v;
  const nv = { at: res.at, when: res.when, started: v && v.at === res.at ? v.started : Date.now(), ids: v && v.at === res.at ? v.ids : [] };
  LS.setJson('visit', nv);
  return nv;
}

function openQuick(gallery = 'liked', draft) {
  if (!settings.canEdit) return;
  let visit = getVisit();
  let cur = draft || { gallery };
  const set = () => cur._set ||= new PhotoSet(cur.photos || {}, { cover: true });
  let saving = Promise.resolve();

  const el = h(`<div class="layer page quick"><div class="pagebar">
      <button class="ic" data-a="back" aria-label="Close">✕</button><span class="pb-title">Quick capture</span>
      <button class="txt" data-a="finish">Done</button></div>
    <div class="scroll"><div class="formwrap">
      <div class="seg"><button data-g="liked">Liked</button><button data-g="mine">My collection</button></div>
      <div class="venue"></div>
      <div class="shot"></div>
      <div class="fromlabel"></div>
      <div class="fld"><label for="q-artist">Artist</label><input id="q-artist" autocapitalize="words" autocomplete="off"><div class="sugg"></div></div>
      <div class="fld"><label for="q-title">Title</label><input id="q-title" autocapitalize="sentences" autocomplete="off"></div>
      <div class="fld"><label for="q-notes">Notes</label><textarea id="q-notes" rows="2" placeholder="Optional"></textarea></div>
      <button class="btn primary wide big" data-a="next">${ICON.camera}Save &amp; take next photo</button>
      <button class="btn link wide" data-a="finish">Save and finish</button>
      <div class="captured"></div>
    </div></div></div>`);
  const inp = { artist: $('#q-artist', el), title: $('#q-title', el), notes: $('#q-notes', el) };

  const hasContent = () => set().ids.length || inp.artist.value.trim() || inp.title.value.trim() || inp.notes.value.trim();
  const saveDraft = () => {
    for (const k in inp) cur[k] = inp[k].value;
    LS.setJson('qcDraft', { ...cur, _set: undefined, photos: set().state() });
  };
  const renderVenue = () => {
    $('.venue', el).hidden = cur.gallery !== 'liked';
    $('.venue', el).innerHTML = `<div class="pin">${ICON.pin}</div><div><b>${esc(visit?.at || 'No place set')}</b><span>${esc(visit?.when || 'Tap Change to add where you are')}</span></div><button class="link" data-a="venue">Change</button>`;
  };
  const renderShot = () => {
    const ids = set().ids;
    $('.shot', el).innerHTML = ids.length
      ? `<div class="ph" data-a="view"><img data-photo="${ids[0]}" alt="">${ids.length > 1 ? `<span class="badge">${ids.length} photos</span>` : ''}</div>
         <div class="btncol"><button class="btn" data-a="retake">${ICON.camera}Retake</button><button class="btn" data-a="more">${ICON.image}Add photo</button></div>
         <div class="addrow full">${lensBtn()}<button class="btn" data-a="paste">${ICON.paste}Paste label</button></div>`
      : `<div class="btncol wide"><button class="btn primary big" data-a="camera">${ICON.camera}Take photo</button>
         <div class="addrow"><button class="btn" data-a="gallery">${ICON.image}From gallery</button></div>
         <div class="addrow">${lensBtn()}<button class="btn" data-a="paste">${ICON.paste}Paste label</button></div></div>`;
    hydrate($('.shot', el));
    const x = cur.extra || {};
    const bits = [x.year, x.medium, fmtSize(x)].filter(Boolean);
    $('.fromlabel', el).innerHTML = bits.length ? `From label: ${esc(bits.join(' · '))}` : '';
  };
  const renderSugg = () => {
    const q = norm(inp.artist.value);
    const names = q ? suggestions('artist').filter(n => norm(n).includes(q) && norm(n) !== q) : recentArtists();
    $('.sugg', el).innerHTML = names.slice(0, 4).map(n => `<button type="button" class="chip" data-artist="${esc(n)}">${esc(n)}</button>`).join('');
  };
  const renderCaptured = () => {
    const ids = (visit?.ids || []).filter(byId);
    $('.captured', el).innerHTML = ids.length && cur.gallery === 'liked'
      ? `<h4>Captured${visit.at ? ' at ' + esc(visit.at) : ' this visit'} (${ids.length})</h4><div class="strip">${ids.slice().reverse().map(id => {
          const w = byId(id);
          return `<div class="pt" data-open="${id}">${w.photos[0] ? `<img data-photo="${w.photos[0]}" alt="">` : `<div class="noimg">${esc((w.title || '?').slice(0, 1))}</div>`}</div>`;
        }).join('')}</div>` : '';
    hydrate($('.captured', el));
    $('.pb-title', el).textContent = ids.length && cur.gallery === 'liked' ? `Quick capture · ${ids.length}` : 'Quick capture';
  };
  const renderAll = () => {
    $$('.seg button', el).forEach(b => b.classList.toggle('on', b.dataset.g === cur.gallery));
    for (const k in inp) inp[k].value = cur[k] || '';
    renderVenue(); renderShot(); renderSugg(); renderCaptured();
  };

  const addPhotos = async (kind, replace) => {
    const filesP = pickFiles(kind); // must start inside the tap, before any waiting
    const files = await filesP;
    await saving;
    if (!files.length) return;
    if (replace) [...set().ids].forEach(id => set().remove(id));
    await set().add(files, cur.gallery === 'liked' ? 1400 : 2000);
    renderShot(); saveDraft();
  };

  const save = async () => {
    for (const k in inp) cur[k] = inp[k].value.trim();
    const ids = set().ids;
    const w = { id: uid(), gallery: cur.gallery, title: cur.title, artist: cur.artist, notes: cur.notes,
      photos: ids, docs: [], created: Date.now(), updated: Date.now(), label: cur.label, ...(cur.extra || {}) };
    delete w.life;
    if (cur.gallery === 'liked' && visit) { w.seenAt = visit.at; w.seenWhen = visit.when; }
    w.ratio = await coverRatio(ids);
    await DB.put('works', clean(w));
    upsertWork(w); touched(); requestPersist();
    if (cur.extra?.life) saveArtistLife(w.artist, cur.extra.life);
    if (cur.gallery === 'liked' && visit) { visit.ids.push(w.id); LS.setJson('visit', visit); }
    cur = { gallery: cur.gallery };
    LS.set('qcDraft', null);
    renderAll(); renderTab();
  };

  pushLayer(el, {
    isDirty: () => hasContent(),
    onClose: () => { set().discard(); LS.set('qcDraft', null); },
    refresh: renderCaptured,
  });

  el.addEventListener('input', e => {
    if (e.target === inp.artist) renderSugg();
    saveDraft();
  });
  el.addEventListener('click', async e => {
    const art = e.target.closest('[data-artist]');
    if (art) { inp.artist.value = art.dataset.artist; renderSugg(); saveDraft(); inp.title.focus(); return; }
    const open = e.target.closest('[data-open]');
    if (open) { openDetail(open.dataset.open); return; }
    const g = e.target.closest('[data-g]')?.dataset.g;
    if (g && g !== cur.gallery) {
      saveDraft(); cur.gallery = g; renderAll(); saveDraft();
      if (g === 'liked' && !visit) { visit = await visitDlg(visit); renderAll(); }
      return;
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'back') closeTop();
    else if (a === 'camera') addPhotos('camera');
    else if (a === 'retake') addPhotos('camera', true);
    else if (a === 'more') addPhotos('camera');
    else if (a === 'gallery') addPhotos('gallery');
    else if (a === 'view') openViewer(set().ids, 0);
    else if (a === 'venue') { visit = await visitDlg(visit); renderAll(); }
    else if (a === 'paste') {
      const text = await pasteLabelDlg();
      if (!text) return;
      const p = parseLabel(text);
      if (p.artist) inp.artist.value = p.artist;
      if (p.title) inp.title.value = p.title;
      if (p.price && !inp.notes.value.trim()) inp.notes.value = p.price;
      cur.extra = { year: p.year, medium: p.medium, sizeH: p.sizeH, sizeW: p.sizeW, sizeD: p.sizeD, unit: p.unit, life: p.life };
      cur.label = text;
      saveDraft(); renderShot(); renderSugg();
    }
    else if (a === 'next') {
      if (hasContent()) {
        const shot = pickFiles('camera'); // open the camera straight away while saving
        saving = save().catch(err => toast(err.message || 'Couldn’t save', 5000));
        await saving;
        toast('Saved', 1500);
        const files = await shot;
        if (files.length) { await set().add(files, cur.gallery === 'liked' ? 1400 : 2000); renderShot(); saveDraft(); }
      } else addPhotos('camera');
    }
    else if (a === 'finish') {
      if (hasContent()) {
        try { await save(); } catch (err) { toast(err.message || 'Couldn’t save', 5000); return; }
      }
      const n = (visit?.ids || []).length;
      await closeTop(true);
      refreshAll();
      if (n) toast(`${plural(n, 'work')} captured${visit.at ? ' at ' + visit.at : ''}`);
    }
  });

  renderAll();
  if (draft) saveDraft();
  if (!draft && gallery === 'liked' && !visit) visitDlg(null).then(v => { visit = v; renderAll(); });
}

/* =========================================================================
 * Gallery labels: paste text (e.g. copied with Google Lens) and split it into fields
 * ========================================================================= */
// There's no official web link for Lens; this asks the Google app to open it,
// and falls back to the Lens website if the phone doesn't understand it.
const LENS_URL = 'intent://lens/#Intent;scheme=googleapp;package=com.google.android.googlequicksearchbox;'
  + 'S.browser_fallback_url=' + encodeURIComponent('https://lens.google.com/') + ';end';
const lensBtn = (cls = '') => /Android/i.test(navigator.userAgent) || isTouch()
  ? `<a class="btn ${cls}" href="${LENS_URL}">${ICON.search}Open Lens</a>` : '';

async function pasteLabelDlg() {
  const canRead = !!navigator.clipboard?.readText;
  const res = await modal(`<h3>Paste label</h3>
    <p class="hint">In <b>Google Lens</b>, point at the label → select the text → <b>Copy</b>. Then come back here and paste it.</p>
    ${lensBtn('wide')}
    <textarea id="lbl" rows="7" placeholder="Paste the label text here"></textarea>
    <div class="btns">${canRead ? '<button class="btn" data-a="clip">Paste</button>' : ''}<span class="grow"></span>
      <button class="btn" data-v="">Cancel</button><button class="btn primary" data-a="use">Use</button></div>`,
  (el, done) => {
    $('[data-a=use]', el).onclick = () => done($('#lbl', el).value.trim());
    if (canRead) $('[data-a=clip]', el).onclick = async () => {
      try { $('#lbl', el).value = await navigator.clipboard.readText(); } catch { toast('Couldn’t read the clipboard — long-press in the box and choose Paste'); }
    };
  });
  return res || '';
}

const MEDIUM_RE = /\b(oil|acrylic|synthetic polymer|polymer paint|watercolou?r|gouache|ink|pencil|graphite|charcoal|pastel|crayon|tempera|enamel|encaustic|screen ?print|silkscreen|serigraph|etching|aquatint|engraving|drypoint|lithograph|woodcut|linocut|woodblock|monotype|monoprint|print|gicl[ée]e|photograph|gelatin silver|inkjet|pigment|chromogenic|type c|ceramic|stoneware|earthenware|porcelain|glass|bronze|marble|steel|timber|textile|wool|cotton|silk|mixed media|collage|assemblage|canvas|linen|board|panel|paper|digital|video)\b/i;
const SKIP_RE = /^(purchased|gift|given|bequest|bequeathed|donated|presented|acquired|collection|private collection|courtesy|on loan|lent by|©|\(c\)|copyright|accession|acc\.|reg\.|image|photo(graph)? by|photo:|sold|nfs|not for sale|enquire)/i;
const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*(?:cm|mm)?\s*[×xX*]\s*(\d+(?:[.,]\d+)?)(?:\s*(?:cm|mm)?\s*[×xX*]\s*(\d+(?:[.,]\d+)?))?\s*(cm|mm|in\b|inches|")?/;
const YEAR_TAIL_RE = /^(.*?)[,\s]+((?:c\.|ca\.|circa)?\s*\d{4}(?:\s*[–—-]\s*\d{2,4})?s?)$/i;

function parseLabel(text) {
  const out = {};
  const lines = String(text).split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const rest = [];
  for (const l of lines) {
    const sm = !out.sizeH && /\d\s*(cm|mm)?\s*[×xX*]\s*\d/.test(l) && l.match(SIZE_RE);
    if (sm) {
      const n = s => s && s.replace(',', '.');
      Object.assign(out, { sizeH: n(sm[1]), sizeW: n(sm[2]), sizeD: n(sm[3]) || '', unit: /in|"/.test(sm[4] || '') ? 'in' : /mm/.test(sm[4] || l) ? 'mm' : 'cm' });
      continue;
    }
    if (/\$\s?\d/.test(l)) { out.price = l; continue; }
    if (SKIP_RE.test(l)) continue;
    rest.push(l);
  }
  // First line: artist, perhaps with life dates — "Name (1951–2020)" or "Name, born 1951"
  if (rest.length) {
    let a = rest.shift(), m;
    if ((m = a.match(/^(.*?)[,\s]*\(([^)]*\d{4}[^)]*)\)\s*$/))) { a = m[1]; out.life = m[2]; }
    else if ((m = a.match(/^(.{3,}?),\s*((?:born|b\.)?\s*\d{4}.*)$/i))) { a = m[1]; out.life = m[2]; }
    out.artist = a.replace(/[.,;:]+$/, '').trim();
  }
  // A nationality / life dates line straight after the artist, e.g. "Australian, born 1951"
  if (rest.length && /\d{4}/.test(rest[0]) && !MEDIUM_RE.test(rest[0])
      && (/\b(born|b\.|died|d\.)/i.test(rest[0]) || /^\(?\s*[A-Z][\w-]*(\s[A-Z][\w-]*)?,?\s*\d{4}\s*[–—-]/.test(rest[0]) || /^\(?[A-Z][a-z]+(?:[ -][A-Z][a-z]+)*,/.test(rest[0]))) {
    out.life ||= rest.shift().replace(/^\(|\)$/g, '');
  }
  for (const l of rest) {
    if (!out.title) {
      const m = l.match(YEAR_TAIL_RE);
      if (m && m[1].length > 1) { out.title = m[1]; out.year ||= m[2]; }
      else if (/^(c\.|ca\.|circa)?\s*\d{4}(\s*[–—-]\s*\d{2,4})?s?$/i.test(l)) out.year ||= l;
      else out.title = l;
      if (out.title) out.title = out.title.replace(/^["“‘']+|["”’',]+$/g, '').trim();
      continue;
    }
    if (!out.year && /^(c\.|ca\.|circa)?\s*\d{4}(\s*[–—-]\s*\d{2,4})?s?$/i.test(l)) { out.year = l; continue; }
    if (!out.medium && MEDIUM_RE.test(l)) { out.medium = l.charAt(0).toUpperCase() + l.slice(1); continue; }
  }
  return out;
}

async function saveArtistLife(name, life) {
  const k = akey(name);
  if (!k || !life) return;
  const rec = S.artists.get(k);
  if (rec?.life) return;
  const r = { ...(rec || { id: k, name: name.trim(), docs: [] }), life, updated: Date.now() };
  await DB.put('artists', r);
  S.artists.set(k, r);
}

/* =========================================================================
 * Artists
 * ========================================================================= */
function renderArtists() {
  const sec = $('#v-artists');
  if (!sec.dataset.built) {
    sec.innerHTML = `<div class="wrap"><div class="top"><h1>Artists</h1><span class="count"></span></div>
      <label class="search">${ICON.search}<input type="search" placeholder="Search artists…" autocomplete="off" spellcheck="false"></label>
      <div class="alist"></div><div class="empty"></div></div>`;
    const q = $('input', sec);
    q.addEventListener('input', () => { S.q.artists = q.value; renderArtists(); });
    $('.alist', sec).addEventListener('click', e => { const r = e.target.closest('[data-key]'); if (r) openArtist(r.dataset.key); });
    sec.dataset.built = '1';
  }
  const q = norm(S.q.artists);
  const all = allArtists();
  const list = all.filter(a => !q || norm(a.name).includes(q)).sort((a, b) => cmp(surname(a.name), surname(b.name)));
  $('.count', sec).textContent = plural(all.length, 'artist');
  $('.alist', sec).innerHTML = list.map(a => {
    const mine = a.works.filter(w => w.gallery === 'mine'), liked = a.works.filter(w => w.gallery === 'liked');
    const pic = [...mine, ...liked].find(w => w.photos[0]);
    const counts = [mine.length && `${mine.length} in collection`, liked.length && `${liked.length} liked`].filter(Boolean).join(' · ');
    return `<button class="arow" data-key="${esc(a.id)}"><div class="av">${pic ? `<img data-photo="${pic.photos[0]}" alt="">` : `<span>${esc(a.name.slice(0, 1))}</span>`}</div>
      <div class="an"><b>${esc(a.name)}</b><span>${esc([a.rec?.life, counts].filter(Boolean).join(' · '))}</span></div></button>`;
  }).join('');
  hydrate($('.alist', sec));
  $('.empty', sec).innerHTML = all.length ? (list.length ? '' : 'No artists match.') : 'Artists appear here as you add works.';
}

function openArtist(key) {
  const el = h(`<div class="layer page"><div class="pagebar"><button class="ic" data-a="back" aria-label="Back">←</button>
    <span class="pb-title"></span><button class="txt edit-only" data-a="edit">Edit</button></div><div class="scroll"></div></div>`);
  let k = key;
  const render = () => {
    const a = allArtists().find(x => x.id === k);
    if (!a) { if (stack[stack.length - 1] === layer) closeTop(true); return; }
    const r = a.rec || {};
    const mine = a.works.filter(w => w.gallery === 'mine').sort(SORTS.year.fn), liked = a.works.filter(w => w.gallery === 'liked').sort(SORTS.year.fn);
    const links = linkList(r.links);
    const sc = $('.scroll', el);
    sc.innerHTML = `<div class="formwrap artist-page">
      <div class="label"><h2>${esc(a.name)}</h2>${r.life ? `<div class="yr">${esc(r.life)}</div>` : ''}</div>
      ${r.bio ? `<div class="note"><h4>Biography</h4><div class="pre">${esc(r.bio)}</div></div>` : ''}
      ${links.length ? `<div class="note"><h4>Links</h4>${links.map(l => `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l.replace(/^https?:\/\/(www\.)?/, ''))}</a>`).join('')}</div>` : ''}
      ${(r.docs || []).length ? `<div class="note"><h4>Documents</h4><div class="strip">${r.docs.map(d => `<div class="pt" data-doc="${d}"><img data-photo="${d}" alt=""></div>`).join('')}</div></div>` : ''}
      ${!r.bio && !links.length && !(r.docs || []).length ? '<p class="hint edit-only">Tap Edit to add a biography, links and documents.</p>' : ''}
      ${mine.length ? `<h3>In my collection (${mine.length})</h3><div class="grid">${mine.map(cardHtml).join('')}</div>` : ''}
      ${liked.length ? `<h3>Liked (${liked.length})</h3><div class="grid">${liked.map(cardHtml).join('')}</div>` : ''}
    </div>`;
    hydrate(sc);
  };
  const layer = pushLayer(el, { refresh: render });
  el.addEventListener('click', async e => {
    const card = e.target.closest('.card');
    if (card) return openDetail(card.dataset.id);
    const doc = e.target.closest('[data-doc]');
    if (doc) return openFile(doc.dataset.doc, S.artists.get(k)?.docs);
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'back') closeTop();
    if (a === 'edit') { const nk = await editArtist(k); if (nk) { k = nk; render(); } }
  });
  render();
}

// Edit an artist's details. Returns the (possibly new) key when saved.
function editArtist(key) {
  return new Promise(resolve => {
    const a = allArtists().find(x => x.id === key);
    const r = a.rec || { id: key, name: a.name, docs: [] };
    const docs = new PhotoSet({ ids: r.docs || [] }, { docs: true });
    let dirty = false, saved = false;
    const el = h(`<div class="layer page editor"><div class="pagebar"><button class="ic" data-a="back" aria-label="Cancel">✕</button>
      <span class="pb-title">Edit artist</span><button class="txt" data-a="save">Save</button></div>
      <div class="scroll"><div class="formwrap"><form class="fields" onsubmit="return false"><div class="fgrid">
        <div class="fld"><label for="a-name">Name</label><input id="a-name" name="name" value="${esc(r.name)}" autocapitalize="words"></div>
        <div class="fld"><label for="a-life">Life dates / nationality</label><input id="a-life" name="life" value="${esc(r.life || '')}" placeholder="e.g. Australian, born 1951"></div>
        <div class="fld"><label for="a-bio">Biography</label><textarea id="a-bio" name="bio" rows="8">${esc(r.bio || '')}</textarea></div>
        <div class="fld"><label for="a-links">Links</label><textarea id="a-links" name="links" rows="2" placeholder="One web address per line" autocapitalize="off" spellcheck="false">${esc(r.links || '')}</textarea></div>
      </div></form>
      <h3>Documents</h3><p class="hint">Biographies, articles, CVs — photos or PDFs.</p><div class="docs"></div>
      <button class="btn primary wide" data-a="save">Save</button></div></div></div>`);
    docs.wire($('.docs', el), () => { dirty = true; });
    $('form', el).addEventListener('input', () => { dirty = true; });
    pushLayer(el, {
      isDirty: () => dirty && !saved,
      onClose: () => { if (!saved) { docs.discard(); resolve(null); } },
    });
    el.addEventListener('click', async e => {
      const act = e.target.closest('[data-a]')?.dataset.a;
      if (act === 'back') closeTop();
      if (act !== 'save') return;
      const f = $('form', el).elements;
      const name = f.name.value.trim();
      if (!name) { toast('The artist needs a name'); return; }
      const nk = akey(name);
      const rec = { ...r, id: nk, name, life: f.life.value.trim(), bio: f.bio.value.trim(), links: f.links.value.trim(), docs: docs.ids, updated: Date.now() };
      await DB.put('artists', clean(rec));
      await docs.commit();
      if (nk !== key) await DB.del('artists', key);
      S.artists.delete(key); S.artists.set(nk, clean(rec));
      // Renaming updates every work by this artist.
      if (name !== a.name) {
        const changed = S.works.filter(w => akey(w.artist) === key);
        changed.forEach(w => { w.artist = name; w.updated = Date.now(); prep(w); });
        await DB.putMany('works', changed.map(clean));
      }
      touched();
      saved = true;
      await closeTop(true);
      resolve(nk);
      refreshAll();
      toast('Saved');
    });
  });
}

/* =========================================================================
 * Zip files (no compression — photos are already compressed)
 * ========================================================================= */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function makeZip(files, onProgress) {
  const enc = new TextEncoder(), d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (let i = 0; i < files.length; i++) {
    const { name, blob } = files[i];
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const nm = enc.encode(name), size = blob.size;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, nm.length, true);
    parts.push(lh, nm, blob);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, offset, true);
    central.push(ch, nm);
    offset += 30 + nm.length + size;
    onProgress?.(i + 1, files.length);
  }
  const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
async function readZip(blob) {
  const tailLen = Math.min(blob.size, 65557);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder(), entries = new Map();
  for (let i = 0, p = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged zip file');
    const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
    entries.set(dec.decode(new Uint8Array(cd.buffer, p + 46, nlen)),
      { method: cd.getUint16(p + 10, true), size: cd.getUint32(p + 20, true), lho: cd.getUint32(p + 42, true) });
    p += 46 + nlen + xlen + clen;
  }
  return {
    async get(name, type = '') {
      const e = entries.get(name);
      if (!e) return null;
      const lh = new DataView(await blob.slice(e.lho, e.lho + 30).arrayBuffer());
      const start = e.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      let part = blob.slice(start, start + e.size);
      if (e.method === 8) part = await new Response(part.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      else if (e.method !== 0) throw new Error('Unsupported zip file');
      return new Blob([await part.arrayBuffer()], { type });
    },
  };
}

/* =========================================================================
 * Backup / restore
 * ========================================================================= */
const README = `Art Catalogue backup

This file holds your whole catalogue: data.json has the details, photos/ and docs/
have the full-size photos and documents, thumbs/ has small previews.

To view or restore it, open https://hanrahs.github.io/art-catalogue/ and choose
Backup → Open backup file.`;

async function buildBackup(onProgress) {
  const photos = await DB.all('photos');
  const meta = [], files = [];
  for (const p of photos) {
    const m = { id: p.id, kind: p.kind, w: p.w, h: p.h, name: p.name };
    m.file = p.kind === 'pdf' ? `docs/${p.id}.pdf` : `photos/${p.id}.jpg`;
    files.push({ name: m.file, blob: p.blob });
    if (p.thumb) { m.thumb = `thumbs/${p.id}.jpg`; files.push({ name: m.thumb, blob: p.thumb }); }
    meta.push(m);
  }
  const data = { app: 'art-catalogue', version: 1, exported: new Date().toISOString(),
    works: S.works.map(clean), artists: [...S.artists.values()], photos: meta };
  files.unshift({ name: 'data.json', blob: new Blob([JSON.stringify(data)], { type: 'application/json' }) },
    { name: 'README.txt', blob: new Blob([README], { type: 'text/plain' }) });
  return { blob: await makeZip(files, onProgress), data };
}

async function doBackup() {
  if (!S.works.length && !S.artists.size) { toast('Nothing to back up yet'); return; }
  let res;
  try {
    toast('Preparing backup…', 0);
    res = await buildBackup((i, n) => { if (i % 20 === 0) toast(`Preparing backup… ${Math.round(i / n * 100)}%`, 0); });
    toast('', 1);
  } catch (e) { toast('Backup failed: ' + e.message, 6000); return; }
  const base = `art-catalogue-backup-${isoDate()}`;
  // Android's share menu only accepts certain file types and .zip isn't one of them,
  // so if needed the backup is shared as .txt. The app opens either.
  let shareFile = null;
  for (const [ext, type] of [['zip', 'application/zip'], ['txt', 'text/plain']]) {
    const f = new File([res.blob], `${base}.${ext}`, { type });
    if (navigator.canShare?.({ files: [f] })) { shareFile = f; break; }
  }
  const phone = isTouch() && shareFile;
  const markDone = () => { LS.set('lastBackup', Date.now()); settings.changes = 0; };
  await modal(`<h3>Backup ready</h3>
    <p>${plural(res.data.works.length, 'artwork')} with ${plural(res.data.photos.length, 'photo')} and documents — ${fmtBytes(res.blob.size)}.</p>
    <p class="hint">${phone ? 'Tap <b>Save to OneDrive</b>, choose <b>OneDrive</b> in the share menu, then pick a folder (e.g. Documents › Art Catalogue). Keep a few old backups.' : 'Save the file into your OneDrive folder.'}</p>
    <div class="btns col">
      ${phone ? '<button class="btn primary" data-a="share">Save to OneDrive…</button>' : ''}
      <button class="btn${phone ? '' : ' primary'}" data-a="download">Download file</button>
      <button class="btn link" data-v="">Cancel</button>
    </div>`,
  (el, done) => {
    $('[data-a=share]', el)?.addEventListener('click', async () => {
      try { await navigator.share({ files: [shareFile], title: shareFile.name }); }
      catch (e) { if (e.name !== 'AbortError') toast('Sharing failed: ' + e.message, 6000); return; }
      markDone(); done(); toast('Backup saved');
    });
    $('[data-a=download]', el).addEventListener('click', () => {
      download(new File([res.blob], `${base}.zip`, { type: 'application/zip' }));
      markDone(); done(); toast('Backup downloaded');
    });
  });
  renderTab();
}

async function doRestore() {
  const [file] = await pickFiles('backup');
  if (!file) return;
  let zip, data;
  try {
    zip = await readZip(file);
    data = JSON.parse(await (await zip.get('data.json')).text());
    if (data.app !== 'art-catalogue' || !Array.isArray(data.works)) throw new Error();
  } catch { toast('That file isn’t an Art Catalogue backup', 5000); return; }
  if (S.works.length || S.artists.size) {
    const ok = await confirmDlg('Open this backup?',
      `Backup from ${fmtTime(Date.parse(data.exported))}: ${plural(data.works.length, 'artwork')}. It replaces everything currently on this device (${plural(S.works.length, 'artwork')}).`,
      'Replace', true);
    if (!ok) return;
  }
  try {
    toast('Opening backup…', 0);
    await DB.clear('works'); await DB.clear('artists'); await DB.clear('photos');
    for (const k of [...urls.keys()]) forget(k.split(':')[0]);
    let batch = [], i = 0;
    for (const m of data.photos) {
      const rec = { id: m.id, kind: m.kind || 'image', w: m.w, h: m.h, name: m.name,
        blob: await zip.get(m.file, m.kind === 'pdf' ? 'application/pdf' : 'image/jpeg') };
      if (m.thumb) rec.thumb = await zip.get(m.thumb, 'image/jpeg');
      if (rec.blob) batch.push(clean(rec));
      if (batch.length >= 25) { await DB.putMany('photos', batch); batch = []; }
      if (++i % 10 === 0) toast(`Opening backup… ${i} of ${data.photos.length} photos`, 0);
    }
    await DB.putMany('photos', batch);
    await DB.putMany('works', data.works);
    await DB.putMany('artists', data.artists || []);
  } catch (e) { toast('Opening the backup failed: ' + e.message, 8000); return; }
  await loadState();
  settings.changes = 0;
  LS.set('loadedBackup', Date.parse(data.exported));
  LS.set('lastBackup', Date.now());
  refreshAll();
  toast(`Opened backup: ${plural(data.works.length, 'artwork')}`);
}

// Removes photos no longer used by anything (e.g. left over if the app was closed mid-edit).
async function cleanupOrphans() {
  const used = new Set();
  const addAll = ids => (ids || []).forEach(x => used.add(x));
  S.works.forEach(w => { addAll(w.photos); addAll(w.docs); });
  S.artists.forEach(a => addAll(a.docs));
  const d = LS.json('draft'), q = LS.json('qcDraft');
  if (d) { addAll(d.photos?.ids); addAll(d.photos?.removed); addAll(d.docs?.ids); addAll(d.docs?.removed); }
  if (q) addAll(q.photos?.ids);
  const orphans = (await DB.keys('photos')).filter(id => !used.has(id));
  await DB.del('photos', orphans);
}

/* =========================================================================
 * Export: spreadsheet and PDF catalogue
 * ========================================================================= */
async function exportCsv() {
  const fields = ALL_FIELDS.filter(f => shows(f, 'mine') || ['seenAt', 'seenWhen'].includes(f.k));
  const head = ['Gallery', ...fields.map(f => f.dlabel || f.label), 'Photos', 'Added'];
  const q = v => /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const rows = [...S.works].sort(SORTS.artist.fn).sort((a, b) => cmp(a.gallery, b.gallery)).map(w =>
    [w.gallery === 'mine' ? 'My collection' : 'Liked', ...fields.map(f => f.type === 'money' ? (w[f.k] ?? '') : fmtField(f, w)),
      w.photos.length, new Date(w.created).toISOString().slice(0, 10)].map(v => q(String(v ?? ''))).join(','));
  const csv = '﻿' + [head.map(q).join(','), ...rows].join('\r\n');
  const r = await shareOrDownload(new File([csv], `art-catalogue-${isoDate()}.csv`, { type: 'text/csv' }));
  if (r !== 'cancelled') toast('Spreadsheet ready');
}

async function exportPdfDlg() {
  const opts = await modal(`<h3>PDF catalogue</h3>
    <div class="fld"><label>Which works</label><div class="seg" data-name="g"><button data-val="mine" class="on">My collection</button><button data-val="liked">Liked</button></div></div>
    <div class="fld"><label>Layout</label><div class="seg" data-name="layout"><button data-val="page" class="on">One per page</button><button data-val="grid">Grid (6 per page)</button></div></div>
    <label class="check"><input type="checkbox" id="x-money" checked> Include prices and values</label>
    <label class="check"><input type="checkbox" id="x-notes" checked> Include notes and stories</label>
    <p class="hint">Opens a preview; then choose <b>Print</b> → <b>Save as PDF</b>.</p>
    <div class="btns"><button class="btn" data-v="">Cancel</button><button class="btn primary" data-a="go">Preview</button></div>`,
  (el, done) => {
    el.addEventListener('click', e => {
      const b = e.target.closest('.seg button');
      if (b) $$('button', b.parentElement).forEach(x => x.classList.toggle('on', x === b));
    });
    $('[data-a=go]', el).onclick = () => done({
      g: $('[data-name=g] .on', el).dataset.val, layout: $('[data-name=layout] .on', el).dataset.val,
      money: $('#x-money', el).checked, notes: $('#x-notes', el).checked,
    });
  });
  if (opts) openPrint(opts);
}

async function openPrint({ g, layout, money: withMoney, notes }) {
  const works = S.works.filter(w => w.gallery === g).sort(SORTS.artist.fn);
  if (!works.length) { toast('No works to export'); return; }
  const title = g === 'mine' ? 'My collection' : 'Liked';
  const valued = works.filter(w => w.value != null);
  const factsFor = w => ALL_FIELDS.filter(f => !['title', 'artist', 'year', 'links', ...TEXT_BLOCKS].includes(f.k)
      && (withMoney || f.type !== 'money'))
    .map(f => [f.dlabel || f.label, fmtField(f, w)]).filter(([, v]) => v);
  const pages = layout === 'page'
    ? works.map(w => `<section class="p-work">
        ${w.photos[0] ? `<div class="p-hero"><img data-print="${w.photos[0]}" data-full="1" alt=""></div>` : ''}
        <div class="p-label"><div class="p-artist">${esc(w.artist || '')}${S.artists.get(akey(w.artist))?.life ? ` <small>(${esc(S.artists.get(akey(w.artist)).life)})</small>` : ''}</div>
          <h2>${esc(w.title || 'Untitled')}</h2>${w.year ? `<div class="p-year">${esc(w.year)}</div>` : ''}</div>
        <dl class="p-facts">${factsFor(w).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        ${notes ? TEXT_BLOCKS.filter(k => w[k]).map(k => `<div class="p-note"><h4>${esc(ALL_FIELDS.find(f => f.k === k).label)}</h4><div class="pre">${esc(w[k])}</div></div>`).join('') : ''}
        ${w.photos.length > 1 ? `<div class="p-more">${w.photos.slice(1, 5).map(p => `<img data-print="${p}" alt="">`).join('')}</div>` : ''}
      </section>`).join('')
    : `<section class="p-grid">${works.map(w => `<div class="p-card">
        <div class="p-thumb">${w.photos[0] ? `<img data-print="${w.photos[0]}" alt="">` : ''}</div>
        <b>${esc(w.title || 'Untitled')}</b><span>${esc([w.artist, w.year].filter(Boolean).join(', '))}</span>
        <span>${esc([w.medium, fmtSize(w)].filter(Boolean).join(' · '))}</span>
        ${withMoney && w.value != null ? `<span>Value ${esc(money(w.value))}</span>` : ''}
        ${g === 'liked' && w.seenAt ? `<span>${esc([w.seenAt, w.seenWhen].filter(Boolean).join(', '))}</span>` : ''}
      </div>`).join('')}</section>`;
  const el = h(`<div class="layer page printview"><div class="pagebar noprint"><button class="ic" data-a="back" aria-label="Back">←</button>
      <span class="pb-title">Preview</span><button class="txt" data-a="print" disabled>Print / PDF</button></div>
    <div class="scroll"><div class="doc">
      <section class="p-cover"><h1>${title}</h1><p>${plural(works.length, 'work')} · ${todayText()}</p>
        ${withMoney && valued.length ? `<p>Total value ${money(valued.reduce((s, w) => s + w.value, 0))}</p>` : ''}</section>
      ${pages}</div></div></div>`);
  pushLayer(el);
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'back') closeTop();
    if (a === 'print') window.print();
  });
  toast('Preparing photos…', 0);
  await Promise.all($$('img[data-print]', el).map(async img => {
    const info = await photoInfo(img.dataset.print, img.dataset.full === '1');
    if (info.kind !== 'image') { img.remove(); return; }
    img.src = info.url;
    try { await img.decode(); } catch { /* ignore */ }
  }));
  toast('', 1);
  $('[data-a=print]', el).disabled = false;
}

/* =========================================================================
 * Backup tab
 * ========================================================================= */
async function renderMore() {
  const sec = $('#v-more');
  const mine = S.works.filter(w => w.gallery === 'mine'), liked = S.works.filter(w => w.gallery === 'liked');
  const valued = mine.filter(w => w.value != null);
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => null);
  const n = settings.changes;
  sec.innerHTML = `<div class="wrap"><div class="top"><h1>Backup</h1></div>
    <div class="panel">
      <h2>Your catalogue</h2>
      <p>${plural(mine.length, 'work')} in My collection · ${plural(liked.length, 'work')} liked · ${plural(allArtists().length, 'artist')}</p>
      ${valued.length ? `<p>Total value of My collection: <b>${money(valued.reduce((s, w) => s + w.value, 0))}</b>${valued.length < mine.length ? ` (${valued.length} of ${mine.length} valued)` : ''}</p>` : ''}
      ${est ? `<p class="hint">Using ${fmtBytes(est.usage || 0)} on this device${persisted ? '' : persisted === false && settings.canEdit ? ' · Android hasn’t yet agreed to keep this permanently, so keep backups up to date' : ''}.</p>` : ''}
    </div>
    ${settings.canEdit ? `<div class="panel">
      <h2>Back up</h2>
      <p>Last backup: <b>${fmtTime(LS.get('lastBackup'))}</b>${n ? ` · ${plural(n, 'change')} since` : ''}</p>
      <button class="btn primary wide" data-a="backup">Back up to OneDrive</button>
      <p class="hint">Makes one file containing everything — details, photos and documents. Your data lives only on this phone, so back up regularly.</p>
    </div>` : ''}
    <div class="panel">
      <h2>Open a backup</h2>
      <p>${settings.canEdit ? 'Restore everything from a backup file — e.g. on a new phone.' : 'Open your latest backup file from OneDrive to view your catalogue on this device.'}</p>
      <button class="btn wide${settings.canEdit ? '' : ' primary'}" data-a="restore">Open backup file…</button>
      <p class="hint">This replaces everything currently on this device.</p>
    </div>
    <div class="panel">
      <h2>Export</h2>
      <button class="btn wide" data-a="pdf">PDF catalogue with photos</button>
      <button class="btn wide" data-a="csv">Spreadsheet (CSV)</button>
      <p class="hint">Handy for insurance. The PDF opens a preview — then choose Print → Save as PDF.</p>
    </div>
    <div class="panel">
      <h2>This device</h2>
      <label class="check"><input type="checkbox" id="canedit"${settings.canEdit ? ' checked' : ''}> Allow adding and editing on this device</label>
      <p class="hint">Keep this on for your phone only. On the laptop leave it off and just open backups, so the phone stays the master copy.</p>
    </div>
    <p class="hint center">Art Catalogue ${APP_VERSION} · No account, no server: everything stays on this device and in your backups.</p>
  </div>`;
  sec.onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'backup') doBackup();
    if (a === 'restore') doRestore();
    if (a === 'csv') exportCsv();
    if (a === 'pdf') exportPdfDlg();
  };
  $('#canedit', sec).onchange = e => { settings.canEdit = e.target.checked; renderTab(); };
}

/* =========================================================================
 * Start
 * ========================================================================= */
async function init() {
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) switchTab(b.dataset.tab); });
  try { await DB.open(); await loadState(); }
  catch (e) { document.body.innerHTML = `<p class="wrap">This browser can’t store data (${esc(e.message)}).</p>`; return; }
  if (history.state?.layer) history.replaceState(null, '');
  switchTab(['mine', 'liked', 'artists', 'more'].includes(LS.get('tab')) ? LS.get('tab') : 'mine');
  await cleanupOrphans();
  // If the phone closed the app mid-entry (e.g. while the camera was open), carry on where it left off.
  const d = LS.json('draft'), q = LS.json('qcDraft');
  if (d && settings.canEdit) { openEditor({ draft: d }); toast('Recovered what you were entering'); }
  else if (q && settings.canEdit) { openQuick(q.gallery, q); toast('Recovered what you were entering'); }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // When a new version has been downloaded, switch to it straight away —
    // or, if something is open (e.g. half-entered artwork), as soon as it's closed.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      if (stack.length) updateReady = true; else location.reload();
    });
    const reg = await navigator.serviceWorker.register('sw.js');
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }
}
let updateReady = false;
init();

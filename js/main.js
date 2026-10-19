import { LAYOUTS, LAYOUT_ORDER, TOOL_DEFS, CORE_TOOLS, toolsFor, FPS_CHOICES, SWATCHES, VERSION, TRACKER_UI, PLAYER_COLORS, POINT_SETS, POINT_SET_ORDER, METRIC_COLORS } from './config.js';
import { Pane } from './pane.js';
import { METRIC_DEFS, suggestRelease } from './metrics.js';
import * as store from './store.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
if (TRACKER_UI) document.documentElement.classList.add('trk-on');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- preferences ---------- */
const PREF_KEY = 'tl.prefs.v1';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (_) { return {}; } };
const prefs = loadPrefs();
let keep = prefs.keep !== false; // keep my work across refreshes
function savePrefs() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ layout: state.layout, hand: state.hand, dir: state.dir, model: state.model, smooth: state.smooth, zoomCrop: state.zoomCrop, fps: state.fps, keep }));
  } catch (_) { /* storage may be blocked */ }
}

export const state = {
  layout: LAYOUTS[prefs.layout] ? prefs.layout : 'side',
  hand: prefs.hand === 'L' ? 'L' : 'R',
  dir: prefs.dir === -1 ? -1 : 1,
  tool: 'line', color: '#f2b63d', w: 5, pin: 'all',
  playing: false, speed: 1, loop: true, link: true,
  fps: FPS_CHOICES.includes(prefs.fps) ? prefs.fps : 30,
  active: 'A', split: false,
  model: ['lite', 'full', 'heavy'].includes(prefs.model) ? prefs.model : 'full',
  smooth: [0, 1, 2].includes(Number(prefs.smooth)) ? Number(prefs.smooth) : 1,
  zoomCrop: prefs.zoomCrop !== false,
  layers: { skeleton: true, joints: true, labels: false, trail: true, lens: true, roi: true },
  layoutChosen: false, pset: null // pset: the point set being placed by hand (shoulders, hips) or null
};

let dirty = true;
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 4200);
}

const app = {
  state,
  stageEl: $('#stage'),
  compareEl: $('#compare'),
  requestRender: () => { dirty = true; },
  setActive, onPaneChange, onMediaLoaded, toast, fileLoaded,
  setTool: (id) => setTool(id)
};
$('#ver').textContent = 'v' + VERSION;
const panes = ['A', 'B'].map((id) => new Pane(id, app));
const act = () => panes.find((p) => p.id === state.active) || panes[0];
const visPanes = () => (state.split ? panes : [panes[0]]);
const targets = () => (state.split && state.link ? panes : [act()]);

/* ---------- tool rail ---------- */
function buildTools() {
  const rail = $('#tools');
  rail.innerHTML = '';
  toolsFor(state.layout).forEach((id, i) => {
    if (i === CORE_TOOLS.length) { const s = document.createElement('div'); s.className = 'sep'; rail.appendChild(s); }
    const d = TOOL_DEFS[id];
    const b = document.createElement('button');
    b.className = 'tool'; b.dataset.tool = id; b.title = `${d.label} (${d.key})`; b.setAttribute('aria-label', d.label);
    b.innerHTML = `<svg viewBox="0 0 24 24">${d.svg}</svg><i>${d.key}</i>`;
    b.onclick = () => setTool(id);
    rail.appendChild(b);
  });
}
function setTool(id) {
  if (!toolsFor(state.layout).includes(id)) return;
  state.tool = id; state.pset = null;
  panes.forEach((p) => { p.draft = null; p.ptDraft = null; p.finishPath(); });
  syncUI(); dirty = true;
}

/* ---------- side panel builders ---------- */
SWATCHES.forEach(([c, name]) => {
  const b = document.createElement('button');
  b.className = 'sw'; b.style.setProperty('--c', c); b.dataset.color = c; b.setAttribute('aria-label', name);
  b.onclick = () => { state.color = c; syncUI(); };
  $('#sws').appendChild(b);
});
$$('#wSeg button').forEach((b) => (b.onclick = () => { state.w = +b.dataset.w; syncUI(); }));
$$('#pinSeg button').forEach((b) => (b.onclick = () => { state.pin = b.dataset.pin; syncUI(); }));
$$('[data-layer]').forEach((c) => (c.onchange = () => { state.layers[c.dataset.layer] = c.checked; dirty = true; }));
FPS_CHOICES.forEach((f) => { const o = document.createElement('option'); o.value = f; o.textContent = f; $('#fps').appendChild(o); });

function buildMeas() {
  const box = $('#meas');
  box.innerHTML = '';
  LAYOUTS[state.layout].metrics.forEach((m) => {
    const def = METRIC_DEFS[m.k];
    const row = document.createElement('div');
    row.className = 'row';
    if (def.note) row.title = def.note;
    const dot = METRIC_COLORS[m.k] ? `<i class="mdot" style="--c:${METRIC_COLORS[m.k]}"></i>` : '';
    row.innerHTML = `<span>${dot}${m.label || def.label}</span><b id="m-${m.k}">—</b>`;
    box.appendChild(row);
  });
}
function updateMeas() {
  const p = act();
  $('#measPane').textContent = `${p.id} · P${p.slot.player} · T${p.slot.throw}`;
  $('#measDesc').hidden = !p.note; $('#measDesc').textContent = p.note;
  const has = !!p.poseFrame();
  $('#measNote').hidden = has;
  $('#measNote').textContent = !TRACKER_UI ? (p.media ? 'Place points with the Point labeler to fill these in.' : 'Open a clip, then place points.') : !p.media ? 'Open a clip, then track a shot.' : p.hasTracking() ? (p.tr[Math.round(p.f)] ? 'No body found on this frame.' : 'This frame is not tracked. Step next to the tracked frames, or press the tracker play.') : 'Track a shot (Body tracking panel) to fill these in.';
  LAYOUTS[state.layout].metrics.forEach((m) => {
    const v = has ? p.metric(m.k) : null;
    $('#m-' + m.k).textContent = v === null ? '—' : METRIC_DEFS[m.k].fmt(v);
  });
}

function updateCompare() {
  const box = $('#compare');
  box.hidden = !state.split;
  if (!state.split) return;
  const L = LAYOUTS[state.layout];
  const cell = (p, k) => {
    if (!p.media) return '—';
    const f = p.rel !== null ? p.rel : Math.round(p.f);
    const v = p.metric(k, f);
    return v === null ? '—' : METRIC_DEFS[k].fmt(v);
  };
  const diff = (k) => {
    const [a, b] = panes.map((p) => (p.media ? p.metric(k, p.rel !== null ? p.rel : Math.round(p.f)) : null));
    if (a === null || b === null) return '—';
    const d = b - a;
    return (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toFixed(0) + (k === 'wristH' || k === 'stance' ? ' pts' : '°');
  };
  box.innerHTML = `<h3>Throw comparison · at the release mark, or the current frame where none is set</h3><table><thead><tr><th>Measurement</th><th class="hA">A</th><th class="hB">B</th><th>B − A</th></tr></thead><tbody>${
    L.metrics.map((m) => `<tr><td>${m.label || METRIC_DEFS[m.k].label}</td><td class="n">${cell(panes[0], m.k)}</td><td class="n">${cell(panes[1], m.k)}</td><td class="n">${diff(m.k)}</td></tr>`).join('')
  }</tbody></table>`;
}

function buildMoments() {
  const p = act();
  $('#momPane').textContent = p.id;
  const mo = $('#moments');
  mo.innerHTML = '';
  if (p.rel === null) {
    const n = document.createElement('p');
    n.className = 'note'; n.textContent = 'Step to the release frame and press Mark release, or track the throw and press Suggest release.';
    mo.appendChild(n);
  } else {
    const b = document.createElement('button');
    b.innerHTML = `<span>Release</span><span>F ${p.rel + 1}</span>`;
    b.onclick = () => jumpRel();
    mo.appendChild(b);
  }
  const tk = $('#ticks');
  tk.querySelectorAll('.tick').forEach((x) => x.remove());
  if (p.rel !== null && p.N > 1) {
    const b = document.createElement('button');
    b.className = 'tick'; b.title = `Release · F ${p.rel + 1}`; b.setAttribute('aria-label', b.title);
    b.style.left = `calc(8px + (100% - 16px) * ${p.rel / (p.N - 1)})`;
    b.onclick = () => jumpRel();
    tk.appendChild(b);
  }
}

/* ---------- layout picker ---------- */
const dlg = $('#picker');
let pk = { layout: 'side', hand: 'R', dir: 1 };
const DIAGRAMS = {
  back: '<path d="M44 40h32l6 -10H38z"/><circle cx="60" cy="12" r="3"/><path d="M60 15v8M56 18h8"/><path d="M60 24v-2"/>',
  side: '<path d="M24 38h72"/><circle cx="40" cy="12" r="3"/><path d="M40 15v12l-4 9M40 27l5 9M40 19l12 6"/><path d="M82 38l12-6"/><rect x="102" y="18" width="10" height="8" rx="1"/>',
  shoulder: '<circle cx="44" cy="14" r="3"/><path d="M44 17v14M44 21l14 3M44 31l-4 9M44 31l5 9"/><rect x="14" y="26" width="12" height="8" rx="1"/><path d="M26 28l12-8" stroke-dasharray="2 2"/><path d="M70 38h30l-4-8H74z"/>',
  broadcast: '<rect x="8" y="6" width="104" height="34" rx="3"/><circle cx="40" cy="16" r="3"/><path d="M40 19v10M36 24h8"/><path d="M60 34h44M60 28h28" stroke-dasharray="3 3"/>'
};
function buildCards() {
  const box = $('#pkCards');
  box.innerHTML = '';
  LAYOUT_ORDER.forEach((id) => {
    const L = LAYOUTS[id];
    const b = document.createElement('button');
    b.className = 'card'; b.dataset.layout = id; b.setAttribute('role', 'radio');
    b.innerHTML = `<svg viewBox="0 0 120 46" aria-hidden="true">${DIAGRAMS[id]}</svg><strong>${L.name}</strong><span>${L.blurb}</span>`;
    b.onclick = () => { pk.layout = id; syncPicker(); };
    box.appendChild(b);
  });
}
function syncPicker() {
  $$('#pkCards .card').forEach((c) => c.setAttribute('aria-checked', c.dataset.layout === pk.layout));
  $$('#pkHand button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.hand === pk.hand));
  $$('#pkDir button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.dir === pk.dir));
  $('#pkDirWrap').hidden = !LAYOUTS[pk.layout].dirChoice;
  $('#pkTips').innerHTML = LAYOUTS[pk.layout].tips.map((t) => `<li>${t}</li>`).join('');
}
function drawPreview() {
  const c = $('#pkCanvas'), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  const p = panes[0];
  if (p.media) {
    const s = Math.min(c.width / p.media.w, c.height / p.media.h), w = p.media.w * s, h = p.media.h * s;
    ctx.drawImage(p.media.el, (c.width - w) / 2, (c.height - h) / 2, w, h);
    $('#pkFile').textContent = `${p.nameEl.textContent} · ${p.metaEl.textContent}`;
  } else $('#pkFile').textContent = 'No clip yet. You can pick a layout now.';
}
function openPicker() {
  pk = { layout: state.layout, hand: state.hand, dir: state.dir };
  buildCards(); drawPreview(); syncPicker();
  if (!dlg.open) dlg.showModal();
}
$$('#pkHand button').forEach((b) => (b.onclick = () => { pk.hand = b.dataset.hand; syncPicker(); }));
$$('#pkDir button').forEach((b) => (b.onclick = () => { pk.dir = +b.dataset.dir; syncPicker(); }));
$('#pkOk').onclick = () => {
  state.hand = pk.hand; state.dir = pk.dir; state.layoutChosen = true;
  applyLayout(pk.layout);
  dlg.close();
};
$('#pkCancel').onclick = () => { state.layoutChosen = true; dlg.close(); };
dlg.addEventListener('cancel', () => { state.layoutChosen = true; });
$('#layoutBtn').onclick = openPicker;

function applyLayout(id) {
  state.layout = id;
  const L = LAYOUTS[id];
  state.split = L.split; state.pin = L.pin;
  if (!toolsFor(id).includes(state.tool)) state.tool = 'line';
  if (!state.split) state.active = 'A';
  panes.forEach((p) => { p.draft = null; p.finishPath(); });
  buildTools(); buildMeas(); syncUI(); savePrefs(); dirty = true;
}

/* ---------- header controls ---------- */
$$('#handSeg button').forEach((b) => (b.onclick = () => { state.hand = b.dataset.hand; savePrefs(); syncUI(); dirty = true; }));
$('#splitBtn').onclick = () => {
  state.split = !state.split;
  if (!state.split) state.active = 'A';
  syncUI(); dirty = true;
};

/* ---------- body tracking: track a shot, step, extend ---------- */
let trRun = null;       // the tracking run in progress: { ctl, pane, whole }
let trBusy = false;     // a single step is being tracked
let trDir = 1;          // which way Play tracks
const tick0 = () => new Promise((r) => setTimeout(r, 0));
const rangeText = (p) => p.ranges().map(([a, b]) => (a === b ? `${a + 1}` : `${a + 1}–${b + 1}`)).join(', ');

function stopTrack() { trRun?.ctl.abort(); }

// Track frames one after another from `start`, going `dir`, until stopped or the clip ends.
// Frames already tracked are stepped over, not redone. whole: the "Analyze whole clip" run.
async function runTrack({ start, dir, whole = false }) {
  const p = act();
  if (!p.media) { toast('Open a clip first.'); return; }
  if (trRun || trBusy) return;
  state.playing = false;
  const ctl = new AbortController();
  trRun = { ctl, pane: p, whole };
  p.analyzing = true;
  const prevF = Math.round(p.f);
  const bar = $('#anBar'), status = $('#anStatus');
  bar.hidden = !whole; bar.value = 0; $('#cancelAn').hidden = !whole;
  status.textContent = 'Starting the body tracker…';
  syncUI();
  let done = 0, found = 0, many = 0;
  try {
    await p.getSession();
    let f = clamp(start ?? Math.round(p.f), 0, p.N - 1);
    while (!ctl.signal.aborted) {
      if (!p.tr?.[f]) {
        const r = await p.trackAt(f, dir);
        done++; if (r.frame) found++; many = Math.max(many, r.people);
      } else if (p.media.type === 'video') await p.seekTo(f);
      p.f = f;
      if (whole) bar.value = (f + 1) / p.N;
      status.textContent = `Tracking frame ${f + 1} · ${done} new · body found in ${found}`;
      drawBands(); dirty = true;
      const nf = f + dir;
      if (nf < 0 || nf >= p.N) break;
      f = nf;
      await tick0();
    }
    let msg = ctl.signal.aborted && !whole ? 'Paused. ' : '';
    if (!done && !found) msg += p.hasTracking() ? 'No new frames needed tracking.' : 'No frames were tracked.';
    else if (!found) msg += 'No body was found. Try the Follow player box (F), or the Most accurate model.';
    else {
      msg += `Tracked ${done} new frame${done === 1 ? '' : 's'}, body found in ${found}. Tracked: ${rangeText(p)}.`;
      if (p.rel === null && p.media.type === 'video' && p.trCount >= 8) {
        const s = suggestRelease(p.smoothed, p.media, state.hand);
        if (s >= 0) { p.rel = s; msg += ` Release suggested at F ${s + 1}.`; }
      }
      if (!p.roi && many > 1) msg += ' Several people were in view. Draw a Follow player box (F) around the thrower and track again.';
    }
    status.textContent = msg;
  } catch (e) {
    status.textContent = `The tracker could not run: ${e.message || e}`;
  } finally {
    p.analyzing = false; trRun = null;
    if (whole && p.media.type === 'video') { p.f = prevF; await p.seekTo(prevF); }
    bar.hidden = true; $('#cancelAn').hidden = true;
    syncUI(); dirty = true;
  }
}

// One frame back or forward. Next to tracked frames it is tracked too, so the range grows by one.
async function trStep(d) {
  const p = act();
  if (!p.media || p.N < 2) return;
  if (trRun) { stopTrack(); return; }
  if (trBusy) return;
  const f = Math.round(p.f), t = clamp(f + d, 0, p.N - 1);
  if (t === f) return;
  trBusy = true; p.analyzing = true; state.playing = false;
  const status = $('#anStatus');
  try {
    if (!p.hasTracking()) { status.textContent = 'Starting the body tracker…'; await p.trackAt(f, d); } // first press: start here
    if (p.tr?.[f] && !p.tr[t]) { await p.trackAt(t, d); status.textContent = `Tracked: ${rangeText(p)}.`; }
    else { p.f = t; if (p.media.type === 'video') await p.seekTo(t); }
    p.f = t;
  } catch (e) { status.textContent = `The tracker could not run: ${e.message || e}`; }
  finally { p.analyzing = false; trBusy = false; syncUI(); dirty = true; }
}
function trPlay() {
  if (trRun) { stopTrack(); return; }
  runTrack({ start: Math.round(act().f), dir: trDir });
}
const runAnalysis = () => runTrack({ start: 0, dir: 1, whole: true });

// Color the tracked stretches on the timeline. Red while the tracker is running.
function drawBands() {
  const p = act(), box = $('#trbands');
  box.innerHTML = '';
  box.classList.toggle('rec', !!trRun);
  if (!p.media || p.N < 2) return;
  for (const [a, b] of p.ranges()) {
    const d = document.createElement('div');
    d.className = 'trband';
    d.style.left = `calc(8px + (100% - 16px) * ${a / (p.N - 1)})`;
    d.style.width = `max(4px, calc((100% - 16px) * ${(b - a) / (p.N - 1)}))`;
    box.appendChild(d);
  }
  for (const pl of [1, 2]) {
    for (const [a, z] of p.pbox[pl].rect ? p.pbox[pl].spans : []) {
      const d = document.createElement('div');
      const end = z === null ? p.N - 1 : z;
      d.className = 'pbband'; d.style.setProperty('--c', PLAYER_COLORS[pl]);
      d.style.left = `calc(8px + (100% - 16px) * ${a / (p.N - 1)})`;
      d.style.width = `max(4px, calc((100% - 16px) * ${Math.max(0, end - a) / (p.N - 1)}))`;
      box.appendChild(d);
    }
  }
  for (const k of POINT_SET_ORDER) {
    for (const kf of p.keyFrames(k)) {
      const t = document.createElement('div');
      t.className = 'ptk'; t.style.setProperty('--c', POINT_SETS[k].color);
      t.style.left = `calc(8px + (100% - 16px) * ${kf / (p.N - 1)})`;
      box.appendChild(t);
    }
  }
}
function updateTrackUI() {
  const p = act(), f = Math.round(p.f), on = !!p.media, vid = on && p.N > 1;
  $('#trFrame').textContent = on ? `Frame ${f + 1} / ${p.N}` : 'Frame – / –';
  const here = $('#trHere');
  if (on && p.hasTracking()) { here.textContent = p.tr[f] ? 'tracked' : 'not tracked'; here.classList.toggle('on', !!p.tr[f]); }
  else { here.textContent = ''; here.classList.remove('on'); }
  if (!trRun && !trBusy) $('#trRange').textContent = !on ? 'Open a clip first.'
    : p.hasTracking() ? `Tracked frames: ${rangeText(p)} (${p.trCount} of ${p.N}). Step beside this range to add frames.`
      : 'Stop on the first frame of the throw, press play, and pause after the release.';
  const rec = !!trRun && !trRun.whole;
  $('#trPlay').classList.toggle('rec', rec);
  $('#trPlay').setAttribute('aria-label', rec ? 'Stop tracking' : 'Track while playing');
  $('#trIcon').innerHTML = rec ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M7 4v16l13-8z"/>';
  $('#trPlay').disabled = !on || (!!trRun && trRun.whole);
  $('#trPrev').disabled = !vid || !!trRun?.whole; $('#trNext').disabled = !vid || !!trRun?.whole;
  $('#trDir').textContent = trDir > 0 ? 'Play: forward →' : 'Play: ← backward';
  $('#trDir').disabled = !!trRun;
  $('#analyze').disabled = !on || !!trRun || trBusy;
}
$('#analyze').onclick = runAnalysis;
$('#cancelAn').onclick = stopTrack;
$('#trPlay').onclick = trPlay;
$('#trPrev').onclick = () => trStep(-1);
$('#trNext').onclick = () => trStep(1);
$('#trDir').onclick = () => { trDir = -trDir; updateTrackUI(); };
$('#clearPose').onclick = () => { stopTrack(); const p = act(); p.clearPose(); $('#anStatus').textContent = 'Tracking cleared.'; syncUI(); dirty = true; };
$('#model').value = state.model; $('#smooth').value = String(state.smooth); $('#zoomCrop').checked = state.zoomCrop;
$('#model').onchange = (e) => { state.model = e.target.value; savePrefs(); };
$('#smooth').onchange = (e) => { state.smooth = +e.target.value; panes.forEach((p) => p.rebuildSmooth()); savePrefs(); syncUI(); dirty = true; };
$('#zoomCrop').onchange = (e) => { state.zoomCrop = e.target.checked; savePrefs(); };

$('#suggest').onclick = () => {
  const p = act();
  if (!p.smoothed) { toast('Track a shot first.'); return; }
  const s = suggestRelease(p.smoothed, p.media, state.hand);
  if (s < 0) { toast('Could not find the throwing wrist. Try the Follow player box.'); return; }
  p.rel = s; p.f = s; syncUI(); dirty = true;
};
$('#clearRel').onclick = () => { act().rel = null; syncUI(); };

const undoAny = () => { const p = act(); if (state.pset && p.undoPts()) return; p.undo(); };
$('#undo').onclick = undoAny;
$('#clear').onclick = () => act().clearAnn();
$('#clearBox').onclick = () => { const p = act(); p.roi = null; p.lens = null; p.pbox = { 1: { rect: null, spans: [] }, 2: { rect: null, spans: [] } }; dirty = true; syncUI(); };

/* ---------- transport ---------- */
function step(d) {
  stopTrack(); state.playing = false;
  targets().forEach((p) => { if (p.media) p.f = clamp(Math.round(p.f) + d, 0, p.N - 1); });
  syncUI(); dirty = true;
}
function goTo(which) {
  stopTrack(); state.playing = false;
  targets().forEach((p) => { if (p.media) p.f = which === 'first' ? 0 : p.N - 1; });
  syncUI(); dirty = true;
}
function togglePlay() {
  stopTrack();
  const list = targets().filter((p) => p.media?.type === 'video');
  if (!list.length) return;
  state.playing = !state.playing;
  if (state.playing && !state.loop) list.forEach((p) => { if (p.f >= p.N - 1) p.f = 0; });
  syncUI();
}
function jumpRel() {
  state.playing = false;
  targets().forEach((p) => { if (p.rel !== null) p.f = p.rel; });
  syncUI(); dirty = true;
}
$('#bFirst').onclick = () => goTo('first'); $('#bLast').onclick = () => goTo('last');
$('#bPrev').onclick = () => step(-1); $('#bNext').onclick = () => step(1);
$('#bPlay').onclick = togglePlay;
$('#speed').onchange = (e) => { state.speed = +e.target.value; };
$('#loop').onclick = () => { state.loop = !state.loop; syncUI(); };
$('#link').onclick = () => { state.link = !state.link; syncUI(); };
$('#align').onclick = () => {
  let any = false;
  panes.forEach((p) => { if (p.rel !== null && p.media) { p.f = p.rel; any = true; } });
  if (any) { state.link = true; state.playing = false; syncUI(); dirty = true; } else toast('Mark the release on each clip first.');
};
$('#fps').onchange = (e) => {
  const v = +e.target.value, p = act();
  state.fps = v; savePrefs();
  if (p.media?.type === 'video') { p.setFps(v); syncUI(); dirty = true; }
};
$('#scrub').oninput = (e) => {
  stopTrack();
  const p = act(), d = +e.target.value - Math.round(p.f);
  state.playing = false;
  targets().forEach((q) => { if (q.media) q.f = clamp(Math.round(q.f) + d, 0, q.N - 1); });
  syncUI(); dirty = true;
};

/* ---------- session save / load / snapshot ---------- */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('#saveSession').onclick = () => {
  const data = { app: 'ThrowLab Analyzer', version: 1, appVersion: VERSION, layout: state.layout, hand: state.hand, dir: state.dir, panes: panes.map((p) => p.toJSON()) };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'throwlab-session.json');
  toast('Session saved. Open the same clips again, then load it to restore everything.');
};
$('#loadSession').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'ThrowLab Analyzer') throw new Error('That is not a ThrowLab session file.');
    state.hand = d.hand === 'L' ? 'L' : 'R'; state.dir = d.dir === -1 ? -1 : 1;
    state.layoutChosen = true;
    d.panes.forEach((pd, i) => { if (panes[i]) panes[i].fromJSON(pd); });
    applyLayout(LAYOUTS[d.layout] ? d.layout : state.layout);
    if (d.panes.length > 1 && !state.split) { state.split = true; syncUI(); }
    const mism = d.panes.some((pd, i) => panes[i]?.media && pd.N && pd.N !== panes[i].N);
    toast(mism ? 'Session loaded, but a clip has a different frame count than when it was saved.' : 'Session loaded.');
    dirty = true;
  } catch (err) { toast(err.message || 'Could not read that session file.'); }
};
$('#snap').onclick = () => {
  const p = act();
  if (!p.media) { toast('Open a clip first.'); return; }
  p.snapshot((b) => b && download(b, `throwlab-${p.id}-F${Math.round(p.f) + 1}.png`));
};

/* ---------- point labeler ---------- */
function setPset(key) {
  state.pset = state.pset === key ? null : key;
  if (state.pset) state.tool = 'cursor';
  panes.forEach((p) => { p.draft = null; p.ptDraft = null; p.finishPath(); });
  syncUI(); dirty = true;
}
POINT_SET_ORDER.forEach((k) => {
  const b = document.createElement('button');
  b.className = 'ptset'; b.dataset.set = k; b.style.setProperty('--c', POINT_SETS[k].color); b.setAttribute('aria-pressed', 'false');
  b.innerHTML = `<i></i><span>${POINT_SETS[k].label}</span><em></em>`;
  b.onclick = () => setPset(k);
  $('#ptSets').appendChild(b);
});
const fr1 = (n) => n + 1; // frames are shown starting from 1
let thrCount = 0;
function updatePtUI() {
  const p = act(), f0 = Math.round(p.f);
  $('#ptPane').textContent = p.id;
  $('#ptSlotLbl').textContent = `Player ${p.slot.player} · Throw ${p.slot.throw}`;
  $$('#ptPlayer button').forEach((b) => { b.setAttribute('aria-pressed', String(+b.dataset.p === p.slot.player)); b.classList.toggle('has', [...Array(p.nThrows)].some((_, i) => p.slotHas(+b.dataset.p, i + 1))); });
  const tb = $('#ptThrow');
  if (thrCount !== p.nThrows) { thrCount = p.nThrows; tb.innerHTML = ''; for (let i = 1; i <= thrCount; i++) { const b = document.createElement('button'); b.dataset.t = i; b.textContent = i; tb.appendChild(b); } }
  $$('#ptThrow button').forEach((b) => { b.setAttribute('aria-pressed', String(+b.dataset.t === p.slot.throw)); b.classList.toggle('has', p.slotHas(p.slot.player, +b.dataset.t)); });
  // player box button: red / blue, on or off at this frame
  const pl = p.slot.player, bon = !!p.media && p.pboxVisible(pl, f0);
  const bt = $('#boxToggle'); bt.style.setProperty('--pc', PLAYER_COLORS[pl]); bt.setAttribute('aria-pressed', String(bon)); bt.textContent = bon ? '✓ Box on' : 'Show box';
  $('#boxInfo').textContent = p.pbox[pl].rect ? `Player ${pl} box: ${p.pboxText(pl)}. It turns on or off from the frame you press Show box on.` : `No box for Player ${pl} yet. Press Draw (F) and drag around the player.`;
  $('#boxClear').disabled = !p.pbox[pl].rect;
  const nt = $('#ptNote'); if (document.activeElement !== nt && nt.value !== p.note) nt.value = p.note;
  POINT_SET_ORDER.forEach((k) => {
    const b = $(`.ptset[data-set=${k}]`), s = p.pts[k], ks = p.keyFrames(k);
    b.setAttribute('aria-pressed', String(state.pset === k));
    b.querySelector('em').textContent = !s ? '' : s.end !== null ? `✓ ${fr1(ks[0])}–${fr1(s.end)}` : `${ks.length} key${ks.length === 1 ? '' : 's'}`;
  });
  // step bar + undo + motion summary
  const f = Math.round(p.f), on = !!p.media && p.N > 1, mo = p.motion();
  $$('#ptTrans button').forEach((b) => (b.disabled = !on));
  $('#ptPlayIcon').innerHTML = state.playing ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M7 4v16l13-8z"/>';
  $('#ptPlay').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  $('#ptFrame').textContent = !p.media ? 'No clip' : `Frame ${f + 1} / ${p.N} · ${(f / p.fps).toFixed(3)} s${mo && f >= mo.start && f <= mo.end ? ' · in the motion' : ''}`;
  $('#ptUndo').disabled = !p.ptHist.length;
  $('#ptSummary').textContent = !mo ? 'Nothing labeled on this throw yet.'
    : `Motion: frame ${fr1(mo.start)} → ${fr1(mo.end)}${mo.open ? ' (not finished: press Finish on the last frame)' : ''}\n${mo.end - mo.start + 1} frames · ${((mo.end - mo.start + 1) / p.fps).toFixed(2)} s · ${p.allKeys().length} keyframe${p.allKeys().length === 1 ? '' : 's'}`;
  const key = state.pset, panel = $('#ptPanel');
  panel.hidden = !key;
  if (!key) return;
  const def = POINT_SETS[key], s = p.pts[key], ks = p.keyFrames(key), cur = p.setPoints(key, f);
  panel.style.setProperty('--c', def.color);
  let hint;
  if (!p.media) hint = 'Open a clip first.';
  else if (cur) hint = cur.key ? 'Keyframe. Drag a dot to move it, or click near the joint to put the nearest dot there. Press D for the next frame.' : 'Following your earlier points. Drag a dot only where the joint has moved, then press D.';
  else if (s && s.end !== null) hint = `${def.label} is finished. Press Edit to change it.`;
  else { const i = p.ptNextIndex(key, f); hint = `Click the ${def.names.slice(i).join(', then the ')} on the video.${key === 'arm' && i === 1 ? ' The shoulder comes from your Shoulders points.' : ''}`; }
  $('#ptHint').textContent = hint;
  $('#ptDone').textContent = s && s.end !== null ? 'Edit' : '✓ Finish';
  $('#ptInfo').textContent = !s ? 'Nothing placed yet.' : `Keyframes: ${ks.map(fr1).join(', ')}. ${s.end !== null ? `Finished, frames ${fr1(ks[0])}–${fr1(s.end)}.` : 'Not finished: the points carry forward until you press Finish on the last frame of the motion.'}`;
  let read = '';
  if (key === 'arm' && cur) read = [['arm', 'Upper arm'], ['forearm', 'Forearm'], ['elbow', 'Elbow'], ['wristBend', 'Wrist']].map(([m, l]) => { const v = p.metric(m); return v === null ? null : `${l} ${METRIC_DEFS[m].fmt(v)}`; }).filter(Boolean).join(' · ');
  $('#ptRead').hidden = !read; $('#ptRead').textContent = read;
}
// Player / throw slots
$$('#ptPlayer button').forEach((b) => (b.onclick = () => act().switchSlot(+b.dataset.p, act().slot.throw)));
$('#ptThrow').onclick = (e) => { const b = e.target.closest('button'); if (b) act().switchSlot(act().slot.player, +b.dataset.t); };
$('#ptThrowAdd').onclick = () => { const p = act(); if (p.nThrows >= 12) { toast('12 throws is the most for one clip.'); return; } p.switchSlot(p.slot.player, p.nThrows + 1); };
$('#ptNote').oninput = (e) => act().setNote(e.target.value);
// Player boxes: Show box turns this player's box on or off from the current frame (frame driven)
$('#boxToggle').onclick = () => {
  const p = act(), pl = p.slot.player, f = Math.round(p.f);
  if (!p.media) { toast('Open a clip first.'); return; }
  if (p.pboxVisible(pl, f)) p.pboxOff(pl, f);
  else if (!p.pbox[pl].rect) { setTool('pbox'); toast(`Drag a box around Player ${pl}.`); }
  else p.pboxOn(pl, f);
};
$('#boxDraw').onclick = () => { if (!act().media) { toast('Open a clip first.'); return; } setTool('pbox'); toast(`Drag a box around Player ${act().slot.player}.`); };
$('#boxClear').onclick = () => { const p = act(); p.pboxClear(p.slot.player); };
// Step bar for the labeler
function goFrame(n) { stopTrack(); state.playing = false; const p = act(); if (p.media) p.f = clamp(n, 0, p.N - 1); syncUI(); dirty = true; }
$('#ptStart').onclick = () => { const m = act().motion(); goFrame(m ? m.start : 0); };
$('#ptEnd').onclick = () => { const p = act(), m = p.motion(); goFrame(m ? m.end : p.N - 1); };
$('#ptBack').onclick = () => step(-1);
$('#ptFwd').onclick = () => step(1);
$('#ptPlay').onclick = togglePlay;
$('#ptPrevKey').onclick = () => { const p = act(), f = Math.round(p.f), ks = p.allKeys().filter((k) => k < f); goFrame(ks.length ? ks[ks.length - 1] : 0); };
$('#ptNextKey').onclick = () => { const p = act(), f = Math.round(p.f), ks = p.allKeys().filter((k) => k > f); goFrame(ks.length ? ks[0] : p.N - 1); };
$('#ptUndo').onclick = () => { if (!act().undoPts()) toast('Nothing to undo.'); };
$('#ptDone').onclick = () => {
  const key = state.pset; if (!key) return;
  const r = act().toggleDone(key);
  if (r === 'none') toast('Place the points first.');
  else if (r === 'early') toast('Step to the last frame of the motion, then press Finish.');
  else if (r === 'done') toast('Finished. Play the clip to see it move.');
};
$('#ptSeed').onclick = () => {
  const key = state.pset; if (!key) return;
  const r = act().seedFromTracker(key);
  if (r === 'none') toast('The tracker has no good points on this frame. Place them by hand.');
  else if (r === 'finished') toast('This set is finished. Press Edit to change it.');
};
$('#ptClear').onclick = () => { const key = state.pset; if (key) act().clearSet(key); };

/* ---------- keep pinch / Ctrl+scroll inside the app ---------- */
// A trackpad pinch arrives as Ctrl+wheel and would zoom the whole browser page. Block that
// everywhere; a pane under the pointer handles it as a video zoom instead.
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });

/* ---------- keyboard ---------- */
// After dragging a slider, give the keys back to the video so D / A / arrows keep stepping frames.
document.addEventListener('pointerup', () => { const a = document.activeElement; if (a && a.tagName === 'INPUT' && a.type === 'range') a.blur(); });
document.addEventListener('keydown', (e) => {
  const tg = e.target.tagName;
  const slider = tg === 'INPUT' && e.target.type === 'range'; // a focused slider must not swallow D / A
  if (dlg.open || tg === 'SELECT' || (tg === 'INPUT' && e.target.type !== 'checkbox' && !slider)) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoAny(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  // D = next frame, A = previous frame (Shift = 5), always on. They move the point labeler with them.
  if (k === 'd') { e.preventDefault(); step(e.shiftKey ? 5 : 1); return; }
  if (k === 'a') { e.preventDefault(); step(e.shiftKey ? -5 : -1); return; }
  if (slider && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; // the slider keeps its own arrow keys
  if (state.pset) {
    if (e.key === 'Enter') { e.preventDefault(); $('#ptDone').click(); return; }
    if (e.key === 'Escape') { setPset(state.pset); return; }
  }
  const keys = Object.fromEntries(Object.entries(TOOL_DEFS).map(([id, d]) => [d.key.toLowerCase(), id]));
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -5 : -1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 5 : 1); }
  else if (e.key === 'Home') goTo('first');
  else if (e.key === 'End') goTo('last');
  else if (e.key === 'Enter') panes.forEach((p) => p.finishPath());
  else if (e.key === '+' || e.key === '=') act().zoomCenter(act().vw.z * 1.5);
  else if (e.key === '-' || e.key === '_') act().zoomCenter(act().vw.z / 1.5);
  else if (e.key === '0') act().fit();
  else if (keys[k]) setTool(keys[k]);
});

/* ---------- state to UI ---------- */
function onPaneChange() { syncUI(); dirty = true; }
function onMediaLoaded(p) {
  if (p.id === state.active || !state.split) $('#fps').value = String(p.fps);
  syncUI(); dirty = true;
  if (!state.layoutChosen) openPicker();
}
function setActive(id) {
  if (!state.split && id !== 'A') return;
  state.active = id; syncUI(); dirty = true;
}

function syncUI() {
  const p = act(), L = LAYOUTS[state.layout];
  $('#layoutName').textContent = L.name;
  panes.forEach((q) => {
    q.el.classList.toggle('active', q.id === state.active && state.split);
    q.el.hidden = !state.split && q.id !== 'A';
  });
  $('#stage').classList.toggle('single', !state.split);
  $('#stage').classList.toggle('drawing', state.tool !== 'cursor');
  $('#stage').classList.toggle('pointing', !!state.pset);
  $$('.tool').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === state.tool));
  $('#toolHint').textContent = TOOL_DEFS[state.tool].hint;
  $$('.sw').forEach((b) => b.setAttribute('aria-pressed', b.dataset.color === state.color));
  $$('#wSeg button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.w === state.w));
  $$('#pinSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.pin === state.pin));
  $$('#handSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.hand === state.hand));
  $('#splitBtn').setAttribute('aria-pressed', state.split);
  $('#loop').setAttribute('aria-pressed', state.loop);
  $('#link').setAttribute('aria-pressed', state.link && state.split);
  $('#link').disabled = !state.split; $('#align').disabled = !state.split;
  $('#playIcon').innerHTML = state.playing ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M7 4v16l13-8z"/>';
  $('#bPlay').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  $('#anPane').textContent = p.id;
  $('#clearPose').disabled = !p.hasTracking();
  $('#suggest').disabled = !p.hasTracking();
  $('#fps').disabled = p.media?.type !== 'video';
  if (p.media) $('#fps').value = String(p.fps);
  $('#annCount').textContent = `${p.ann.length} on clip ${p.id}`;
  buildMoments(); drawBands(); updateCompare(); tickUI();
}

function tickUI() {
  const p = act(), f = Math.round(p.f);
  const sc = $('#scrub');
  sc.max = Math.max(0, p.N - 1); sc.value = f; sc.disabled = !p.media || p.N < 2;
  $('#readout').textContent = !p.media ? 'No clip' : p.media.type === 'image' ? 'Photo' : `F ${f + 1} / ${p.N} · ${(f / p.fps).toFixed(3)} s`;
  updateMeas(); updateTrackUI(); updatePtUI();
}

/* ---------- main loop ---------- */
let last = performance.now();
function loop(ts) {
  const dt = Math.min(0.1, (ts - last) / 1000);
  last = ts;
  if (state.playing) {
    let moving = false;
    targets().forEach((p) => {
      if (p.media?.type !== 'video') return;
      p.f += dt * p.fps * state.speed;
      if (p.f >= p.N - 1) { if (state.loop) p.f = 0; else p.f = p.N - 1; } else moving = true;
    });
    if (!moving && !state.loop) { state.playing = false; syncUI(); }
    dirty = true;
  }
  if (dirty) {
    dirty = false;
    visPanes().forEach((p) => p.render());
    tickUI();
    updateCompare();
    if (!state.playing) scheduleSave();
  }
  requestAnimationFrame(loop);
}

/* ---------- keep my work across refreshes ---------- */
let restoring = false, saveTimer = 0, storeWarned = false, persistAsked = false;
const warnStore = () => { if (!storeWarned) { storeWarned = true; toast('This browser would not keep the clip. Your drawings are still saved, but you will need to reopen the video after a refresh.'); } };
function fileLoaded(p, file) {
  if (!keep) return;
  if (!persistAsked) { persistAsked = true; try { navigator.storage?.persist?.(); } catch (_) { /* ignore */ } }
  store.put('file:' + p.id, file).catch(warnStore);
  scheduleSave();
}
function scheduleSave() {
  if (!keep || restoring) return;
  clearTimeout(saveTimer); saveTimer = setTimeout(saveWork, 800);
}
async function saveWork() {
  clearTimeout(saveTimer);
  if (!keep || restoring || !panes.some((p) => p.media)) return;
  try {
    await store.put('state', {
      v: 1, appVersion: VERSION, savedAt: Date.now(),
      layout: state.layout, hand: state.hand, dir: state.dir, split: state.split, active: state.active,
      tool: state.tool, color: state.color, w: state.w, pin: state.pin, speed: state.speed, loop: state.loop, link: state.link,
      panes: panes.map((p) => ({ ...p.toJSON(), has: !!p.media, f: Math.round(p.f) }))
    });
    $('#savedNote').textContent = 'Saved in this browser at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '. Nothing is uploaded.';
  } catch (_) { warnStore(); }
}
async function restoreWork() {
  if (!keep) return;
  let st, files;
  try { st = await store.get('state'); files = await Promise.all(['A', 'B'].map((id) => store.get('file:' + id))); } catch (_) { return; }
  if (!st || !Array.isArray(st.panes) || !files.some(Boolean)) return;
  restoring = true;
  try {
    state.layoutChosen = true;
    state.hand = st.hand === 'L' ? 'L' : 'R'; state.dir = st.dir === -1 ? -1 : 1;
    for (let i = 0; i < 2; i++) {
      const pd = st.panes[i], p = panes[i];
      if (!files[i] || !pd || !pd.has) continue;
      await p.loadFile(files[i], { restore: true, fps: pd.fps });
      if (!p.media) continue;
      p.fromJSON(pd);
      p.f = clamp(pd.f || 0, 0, p.N - 1);
      if (p.media.type === 'video') await p.seekTo(Math.round(p.f));
    }
    applyLayout(LAYOUTS[st.layout] ? st.layout : state.layout);
    state.split = !!st.split && !!panes[1].media; state.active = state.split && st.active === 'B' ? 'B' : 'A';
    if (st.pin === 'frame' || st.pin === 'all') state.pin = st.pin;
    if (typeof st.color === 'string') state.color = st.color;
    if ([3, 5, 8].includes(st.w)) state.w = st.w;
    if (toolsFor(state.layout).includes(st.tool)) state.tool = st.tool;
    if ([0.1, 0.25, 0.5, 1].includes(st.speed)) state.speed = st.speed;
    state.loop = st.loop !== false; state.link = st.link !== false;
    $('#speed').value = String(state.speed);
    buildTools(); syncUI(); dirty = true;
    const names = panes.filter((p) => p.media).map((p) => p.nameEl.textContent).join(' and ');
    toast('Restored your last session: ' + names + '. Use "Clear saved work" in the side panel to start fresh.');
  } catch (err) { toast('Could not restore your last session.'); } finally { restoring = false; }
}
$('#keepWork').checked = keep;
$('#keepWork').onchange = (e) => {
  keep = e.target.checked; savePrefs();
  if (keep) { panes.forEach((p) => { if (p.file) store.put('file:' + p.id, p.file).catch(warnStore); }); scheduleSave(); toast('Your work will be kept when you refresh.'); }
  else { clearTimeout(saveTimer); store.clearAll().catch(() => {}); $('#savedNote').textContent = 'Not saving. Refreshing will clear your work.'; toast('Saving is off. Saved work was deleted from this browser.'); }
};
$('#clearSaved').onclick = () => {
  clearTimeout(saveTimer);
  store.clearAll().then(() => { $('#savedNote').textContent = 'Saved work cleared.'; toast('Saved work cleared. What is on screen stays until you refresh.'); }).catch(() => toast('Nothing to clear.'));
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveWork(); });
window.addEventListener('pagehide', () => { saveWork(); });

buildTools(); buildMeas(); syncUI();
if (document.fonts?.ready) document.fonts.ready.then(() => { dirty = true; });
requestAnimationFrame(loop);
window.__throwlab = { state, panes, applyLayout, runAnalysis, setPset, restored: restoreWork() };

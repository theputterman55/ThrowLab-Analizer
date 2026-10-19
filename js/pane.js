// One video (or photo) pane: media, frame stepping, drawing, body overlay.
import { drawAnn, annDist, tag } from './annotate.js';
import { COL, FPS_CHOICES, POINT_SETS, POINT_SET_ORDER, TRACKER_UI, PLAYER_COLORS } from './config.js';
import { smoothFrames, packFrames, unpackFrames, TrackSession, bboxOf, followBox } from './pose.js';
import { roleIndex, throwingWristIndex, computeMetric, angle3, METRIC_DEFS } from './metrics.js';

const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [27, 29], [28, 30], [15, 19], [16, 20]];
const ARM_R = new Set(['12-14', '14-16', '16-20']);
const ARM_L = new Set(['11-13', '13-15', '15-19']);
const AMBER = '#f2b63d';

async function detectFps(v) {
  if (!('requestVideoFrameCallback' in v)) return null;
  return new Promise((resolve) => {
    const times = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      let q = 0;
      try { const p = v.getVideoPlaybackQuality?.(); if (p && v.currentTime > 0.3) q = (p.totalVideoFrames - (p.droppedVideoFrames || 0)) / v.currentTime; } catch (_) { /* ignore */ }
      try { v.pause(); v.currentTime = 0; } catch (_) { /* ignore */ }
      const d = [];
      for (let i = 1; i < times.length; i++) { const dt = times[i] - times[i - 1]; if (dt > 0) d.push(dt); }
      d.sort((a, b) => a - b);
      const med = d.length >= 4 ? 1 / d[Math.floor(d.length / 2)] : 0;
      const est = Math.max(med, q);
      if (!est) return resolve(null);
      let best = null, bd = 1e9;
      for (const c of FPS_CHOICES) { const e = Math.abs(c - est) / c; if (e < bd) { bd = e; best = c; } }
      resolve(bd < 0.12 ? best : null);
    };
    const cb = (now, meta) => { times.push(meta.mediaTime); if (times.length >= 20) finish(); else v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
    v.play().then(() => setTimeout(finish, 1400)).catch(finish);
    setTimeout(finish, 3000);
  });
}

const PIN_LEN = 110; // length of the rotate pin, in drawing units (scaled so it stays the same size on screen)
const newPBox = () => ({ 1: { rect: null, spans: [] }, 2: { rect: null, spans: [] } });

export class Pane {
  constructor(id, app) {
    this.id = id; this.app = app;
    this.media = null; this.url = null;
    this.f = 0; this.N = 0; this.fps = 30; this.fpsSource = 'default';
    this.ann = []; this.hist = []; this.draft = null; this.pathAnn = null;
    this.rel = null; this.roi = null; this.lens = null;
    this.raw = null; this.smoothed = null; this.poseInfo = null;
    this.tr = null; this.boxes = null; this.trCount = 0; this.session = null; // tr[f] = 1 where the body tracker has run
    this.pbox = newPBox(); this.slots = {}; this.slot = { player: 1, throw: 1 }; this.nThrows = 4; this.ptHist = []; this.ptDraft = null; this.pdrag = null; this.ptVer = 0; this.sv = 0; this.pcache = null; // hand-placed points
    this.analyzing = false; this.seeking = false;
    // View (zoom/pan) in canvas pixels: screen = point * z + (tx, ty). hold locks it.
    this.vw = { z: 1, tx: 0, ty: 0, hold: false }; this.pan = null;
    this.ptrs = new Map(); this.pinch = null;
    // vsz: size of the video in drawing units. The canvas is the whole viewing window; k fits the video inside it.
    this.vsz = { W: 1280, H: 720 }; this.k = 1; this.dpr = 1;
    this.tmp = document.createElement('canvas');
    this.build();
  }

  build() {
    const el = document.createElement('section');
    el.className = 'pane'; el.dataset.id = this.id;
    el.innerHTML = `<header class="ph"><span class="chip c${this.id}">${this.id}</span><span class="pname">No clip loaded</span><span class="pmeta"></span><span class="grow"></span>
      <button class="btn sm" data-act="rel" title="Mark the release at the current frame">Mark release</button>
      <label class="btn sm" title="Open a video or photo">Open clip<input type="file" accept="video/*,image/*" hidden></label></header>
      <div class="view"><canvas width="1280" height="720" aria-label="Clip ${this.id}"></canvas><div class="tc"></div>
      <div class="zoomctl" role="group" aria-label="Zoom" hidden>
        <button type="button" data-z="lens" title="Zoom window: drag a box to magnify it in a corner window (Z)" aria-label="Zoom window"><svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6"/><path d="M15 15l5 5M10 7v6M7 10h6"/></svg></button>
        <button type="button" data-z="out" title="Zoom out (-)" aria-label="Zoom out">&minus;</button>
        <input type="range" min="0" max="100" step="1" value="0" aria-label="Zoom level">
        <button type="button" data-z="in" title="Zoom in (+)" aria-label="Zoom in">+</button>
        <span class="zread">100%</span>
        <button type="button" data-z="fit" title="Fit to pane (0 or double-click)">Fit</button>
        <button type="button" data-z="hold" aria-pressed="false" title="Hold: lock the zoom and position so nothing moves it">Hold</button>
      </div>
      <div class="empty"><strong>Open a clip</strong><span>Choose a video or photo, or drop one here.</span></div></div>`;
    this.app.stageEl.insertBefore(el, this.app.compareEl);
    this.el = el;
    this.cv = el.querySelector('canvas'); this.ctx = this.cv.getContext('2d');
    this.tc = el.querySelector('.tc'); this.nameEl = el.querySelector('.pname'); this.metaEl = el.querySelector('.pmeta');
    this.emptyEl = el.querySelector('.empty'); this.view = el.querySelector('.view');
    // The viewing window follows the pane width and the window height; the video is fitted inside it.
    this.ro = new ResizeObserver(() => this.layout()); this.ro.observe(this.view);
    window.addEventListener('resize', () => this.layout());
    el.addEventListener('pointerdown', () => { if (this.app.state.active !== this.id) this.app.setActive(this.id); }, true);
    this.cv.addEventListener('pointerdown', (e) => this.onDown(e));
    this.cv.addEventListener('pointermove', (e) => this.onMove(e));
    this.cv.addEventListener('pointerup', (e) => this.onUp(e));
    this.cv.addEventListener('pointercancel', (e) => { this.ptrs.delete(e.pointerId); this.pinch = null; this.draft = null; this.pdrag = null; this.endPan(); this.app.requestRender(); });
    this.cv.addEventListener('contextmenu', (e) => { if (this.media) e.preventDefault(); });
    this.cv.addEventListener('dblclick', () => { if (this.media && this.app.state.tool === 'cursor') this.fit(); });
    // Pinch on a trackpad arrives as Ctrl+wheel; a mouse wheel zooms too. Both zoom toward the pointer.
    this.view.addEventListener('wheel', (e) => {
      if (!this.media) return;
      if (this.vw.hold) { if (e.ctrlKey) e.preventDefault(); return; }
      e.preventDefault();
      let dy = e.deltaY; if (e.deltaMode === 1) dy *= 16;
      const [cx, cy] = this.canvasXY(e);
      this.zoomAt(cx, cy, this.vw.z * Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0025)));
    }, { passive: false });
    // Safari reports trackpad pinch as gesture events instead of Ctrl+wheel.
    let gz0 = 1;
    this.view.addEventListener('gesturestart', (e) => { e.preventDefault(); gz0 = this.vw.z; });
    this.view.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      if (this.media && !this.vw.hold) { const [cx, cy] = this.canvasXY(e); this.zoomAt(cx, cy, gz0 * e.scale); }
    });
    this.view.addEventListener('gestureend', (e) => e.preventDefault());
    this.zc = el.querySelector('.zoomctl');
    this.zSlider = this.zc.querySelector('input'); this.zRead = this.zc.querySelector('.zread');
    this.zc.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.zc.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const a = b.dataset.z;
      if (a === 'lens') this.app.setTool('lens');
      else if (a === 'in') this.zoomCenter(this.vw.z * 1.5);
      else if (a === 'out') this.zoomCenter(this.vw.z / 1.5);
      else if (a === 'fit') this.fit();
      else if (a === 'hold') this.setHold(!this.vw.hold);
    });
    this.zSlider.addEventListener('input', () => this.zoomCenter(Math.pow(2, this.zSlider.value / 25)));
    el.querySelector('[data-act=rel]').onclick = () => { this.rel = Math.round(this.f); this.app.onPaneChange(this); };
    el.querySelector('input[type=file]').onchange = (e) => { const f = e.target.files[0]; if (f) this.loadFile(f); e.target.value = ''; };
    this.view.addEventListener('dragover', (e) => { e.preventDefault(); this.view.classList.add('drop'); });
    this.view.addEventListener('dragleave', () => this.view.classList.remove('drop'));
    this.view.addEventListener('drop', (e) => {
      e.preventDefault(); this.view.classList.remove('drop');
      const f = e.dataTransfer?.files?.[0]; if (f) this.loadFile(f);
    });
    this.emptyEl.addEventListener('click', () => el.querySelector('input[type=file]').click());
  }

  // ---------- media ----------
  release() {
    if (this.url) URL.revokeObjectURL(this.url);
    if (this.media?.type === 'video') this.media.el.remove();
    this.closeSession(); this.clearPose();
    this.url = null; this.media = null;
  }

  // opts.restore: reopening saved work (skip frame-rate detection and do not re-store the file). opts.fps: saved frame rate.
  async loadFile(file, opts = {}) {
    this.release();
    this.nameEl.textContent = file.name;
    this.metaEl.textContent = 'Loading…';
    const url = URL.createObjectURL(file);
    this.url = url; this.file = file;
    try {
      const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name);
      if (isImg) {
        const img = new Image(); img.src = url; await img.decode();
        this.media = { type: 'image', el: img, w: img.naturalWidth, h: img.naturalHeight };
        this.N = 1; this.fps = 30; this.fpsSource = 'image';
      } else {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
        v.className = 'media-host';
        document.getElementById('mediaHost').appendChild(v);
        await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('This video could not be read. iPhone HEVC clips may not play in every browser. Try Chrome or Safari, or re-export the clip as H.264 MP4.')); });
        if (!v.videoWidth) throw new Error('This video has no picture track the browser can read.');
        this.media = { type: 'video', el: v, w: v.videoWidth, h: v.videoHeight, dur: v.duration };
        this.metaEl.textContent = 'Detecting frame rate…';
        const fps = opts.fps || await detectFps(v);
        if (fps) { this.fps = fps; this.fpsSource = opts.fps ? 'restored' : 'detected'; } else { this.fps = this.app.state.fps; this.fpsSource = 'default'; }
        this.N = Math.max(1, Math.round(v.duration * this.fps));
      }
    } catch (err) {
      this.release(); this.media = null; this.N = 0;
      this.nameEl.textContent = 'No clip loaded'; this.metaEl.textContent = ''; this.syncZoom();
      this.app.toast(err.message || 'Could not open that file.');
      this.app.onPaneChange(this);
      return;
    }
    const s = Math.min(1, 1600 / this.media.w);
    this.vsz = { W: Math.round(this.media.w * s), H: Math.round(this.media.h * s) };
    this.f = 0; this.ann = []; this.hist = []; this.rel = null; this.roi = null; this.lens = null;
    this.clearPose(); this.draft = null; this.pathAnn = null;
    this.resetSlots();
    this.vw = { z: 1, tx: 0, ty: 0, hold: false }; this.pan = null; this.layout(); this.syncZoom();
    this.emptyEl.hidden = true;
    this.updateMeta();
    if (this.media.type === 'video') await this.seekTo(0);
    if (!opts.restore) this.app.fileLoaded?.(this, file);
    this.app.onMediaLoaded(this);
  }

  updateMeta() {
    if (!this.media) { this.metaEl.textContent = ''; return; }
    const m = this.media;
    this.metaEl.textContent = m.type === 'image'
      ? `${m.w}×${m.h} photo`
      : `${m.w}×${m.h} · ${this.fps} fps${this.fpsSource === 'default' ? ' (assumed)' : ''}`;
  }

  setFps(fps) {
    if (this.media?.type !== 'video') return;
    this.fps = fps; this.fpsSource = 'set';
    this.N = Math.max(1, Math.round(this.media.dur * fps));
    this.f = Math.min(this.f, this.N - 1);
    this.clearPose();
    this.updateMeta();
  }

  frameTime(f) { return Math.min(Math.max(0, (f + 0.5) / this.fps), Math.max(0, this.media.dur - 0.001)); }

  ensureSeek() {
    const v = this.media?.el;
    if (this.media?.type !== 'video' || this.seeking) return;
    const t = this.frameTime(Math.round(this.f));
    if (Math.abs(v.currentTime - t) > 0.5 / this.fps) {
      this.seeking = true;
      const done = () => { v.removeEventListener('seeked', done); this.seeking = false; this.app.requestRender(); };
      v.addEventListener('seeked', done);
      v.currentTime = t;
    }
  }

  seekTo(f) {
    return new Promise((resolve) => {
      const v = this.media.el;
      const t = this.frameTime(f);
      if (Math.abs(v.currentTime - t) < 1e-4) { resolve(); return; }
      let finished = false;
      const done = () => { if (finished) return; finished = true; v.removeEventListener('seeked', done); this.seeking = false; resolve(); };
      v.addEventListener('seeked', done);
      this.seeking = true;
      v.currentTime = t;
      setTimeout(done, 4000);
    });
  }

  // ---------- body data ----------
  // Load saved tracking. extra.ranges = tracked frame ranges, extra.boxes = the Follow box used on each frame.
  setPose(raw, info, extra) {
    this.raw = raw; this.poseInfo = info || null;
    this.tr = new Uint8Array(raw.length);
    if (extra?.ranges) { for (const [a, b] of extra.ranges) for (let i = a; i <= b && i < raw.length; i++) this.tr[i] = 1; } else this.tr.fill(1);
    this.boxes = extra?.boxes ? extra.boxes.map((q) => (q ? { x: q[0], y: q[1], w: q[2], h: q[3] } : null)) : new Array(raw.length).fill(null);
    this.recount(); this.rebuildSmooth();
  }
  recount() { let n = 0; if (this.tr) for (const v of this.tr) n += v; this.trCount = n; }
  hasTracking() { return this.trCount > 0; }
  ensurePose() {
    if (this.raw && this.raw.length === this.N) return;
    this.raw = new Array(this.N).fill(null); this.tr = new Uint8Array(this.N); this.boxes = new Array(this.N).fill(null); this.trCount = 0;
  }
  clearPose() { this.sv++; this.raw = null; this.smoothed = null; this.poseInfo = null; this.tr = null; this.boxes = null; this.trCount = 0; }
  // Store the result for one frame (frame may be null: tracked, nobody found).
  putFrame(f, frame, box) {
    this.ensurePose();
    this.raw[f] = frame; if (!this.tr[f]) this.trCount++; this.tr[f] = 1; this.boxes[f] = box ? { ...box } : null;
    this.poseInfo = { model: this.app.state.model, zoomCrop: this.app.state.zoomCrop, fps: this.fps };
    this.rebuildSmooth();
  }
  // Tracked stretches as [[first, last], ...] (0-based frame numbers).
  ranges() {
    const out = []; if (!this.tr) return out;
    for (let i = 0; i < this.tr.length; i++) {
      if (!this.tr[i]) continue;
      let j = i; while (j + 1 < this.tr.length && this.tr[j + 1]) j++;
      out.push([i, j]); i = j;
    }
    return out;
  }
  async getSession() {
    const m = this.app.state.model;
    if (this.session && this.session.key === m) return this.session;
    this.closeSession();
    this.session = await TrackSession.create(m);
    return this.session;
  }
  closeSession() { try { this.session?.close(); } catch (_) { /* ignore */ } this.session = null; }
  // Show frame f, then run the tracker on it. dir (+1/-1) says which way the tracking is travelling, so
  // the Follow box and the person to pick carry over from the frame it came from.
  async trackAt(f, dir) {
    if (this.media.type === 'video') await this.seekTo(f);
    this.f = f;
    const sess = await this.getSession(), st = this.app.state, nb = f - dir;
    let box = this.roi, prev = null;
    if (this.tr?.[nb]) {
      const bb = this.raw[nb] ? bboxOf(this.raw[nb]) : null;
      prev = bb;
      if (this.boxes[nb]) box = followBox(this.boxes[nb], bb);
    }
    const r = sess.detect(this, box, prev, st.zoomCrop);
    this.putFrame(f, r.frame, box);
    return r;
  }
  rebuildSmooth() { this.sv++; this.smoothed = this.raw ? smoothFrames(this.raw, this.app.state.smooth) : null; }
  // The body on frame f: the tracker's result, with any hand-placed joints laid over it.
  poseFrame(f = Math.round(this.f)) {
    const base = TRACKER_UI && this.smoothed ? this.smoothed[f] || null : null;
    const hand = this.app.state.hand, key = `${f}|${this.ptVer}|${this.sv}|${hand}`;
    if (this.pcache && this.pcache.key === key) return this.pcache.v;
    let out = base;
    for (const k of Object.keys(this.pts).sort((a, b) => (b === 'arm') - (a === 'arm'))) { // the Arm set goes first so Shoulders wins on the shared shoulder
      const cur = this.setPoints(k, f); if (!cur || !POINT_SETS[k]) continue;
      if (out === base) out = base ? Float32Array.from(base) : new Float32Array(99);
      POINT_SETS[k].roles.forEach((r, j) => { const i = roleIndex(r, hand) * 3; out[i] = cur.pts[j][0]; out[i + 1] = cur.pts[j][1]; out[i + 2] = 1; });
    }
    this.pcache = { key, v: out };
    return out;
  }

  // ---------- player / throw slots ----------
  // Each player + throw number keeps its own set of hand-placed points (and a note). this.pts is the active slot's points.
  slotKey(player = this.slot.player, thr = this.slot.throw) { return `${player}-${thr}`; }
  slotData(key = this.slotKey()) { return this.slots[key] || (this.slots[key] = { pts: {}, note: '' }); }
  get pts() { return this.slotData().pts; }
  set pts(v) { this.slotData().pts = v; }
  get note() { return this.slotData().note; }
  setNote(t) { this.slotData().note = t; this.app.onPaneChange(this, true); }
  slotHas(player, thr) { const d = this.slots[this.slotKey(player, thr)]; return !!d && (Object.keys(d.pts).length > 0 || !!d.note); }
  switchSlot(player, thr) {
    this.slot = { player, throw: thr }; this.nThrows = Math.max(this.nThrows, thr);
    this.ptHist = []; this.ptDraft = null; this.pdrag = null; this.ptChanged();
  }
  resetSlots() { this.pbox = newPBox(); this.slots = {}; this.slot = { player: 1, throw: 1 }; this.nThrows = 4; this.ptHist = []; this.ptDraft = null; this.pdrag = null; this.ptVer++; }
  // When the labeled motion starts and ends on this slot (all sets together). open = a set is not finished yet.
  motion() {
    let a = null, b = null, open = false;
    for (const k of POINT_SET_ORDER) {
      const ks = this.keyFrames(k); if (!ks.length) continue;
      const s = this.pts[k], last = s.end !== null ? s.end : ks[ks.length - 1];
      if (s.end === null) open = true;
      a = a === null ? ks[0] : Math.min(a, ks[0]); b = b === null ? last : Math.max(b, last);
    }
    return a === null ? null : { start: a, end: b, open };
  }
  allKeys() { const set = new Set(); for (const k of POINT_SET_ORDER) this.keyFrames(k).forEach((x) => set.add(x)); return [...set].sort((x, y) => x - y); }

  // ---------- player boxes (frame driven) ----------
  // Each player has one box and a list of frame spans where it shows: [from, to] (to = null: until switched off).
  pboxVisible(player, f) { const b = this.pbox[player]; return !!(b && b.rect) && b.spans.some(([a, z]) => f >= a && (z === null || f <= z)); }
  pboxCut(player, f) { // switch the box off from frame f on
    const b = this.pbox[player];
    b.spans = b.spans.map(([a, z]) => (f >= a && (z === null || f <= z) ? [a, f - 1] : [a, z])).filter(([a, z]) => z === null || z >= a);
  }
  pboxOn(player, f) { // show this player's box from frame f; the other player's box goes off at f
    const b = this.pbox[player]; if (!b || !b.rect) return false;
    this.pboxCut(player === 1 ? 2 : 1, f);
    if (!this.pboxVisible(player, f)) b.spans.push([f, null]);
    this.app.requestRender(); this.app.onPaneChange(this, true); return true;
  }
  pboxOff(player, f) { this.pboxCut(player, f); this.app.requestRender(); this.app.onPaneChange(this, true); }
  pboxClear(player) { this.pbox[player] = { rect: null, spans: [] }; this.app.requestRender(); this.app.onPaneChange(this, true); }
  pboxText(player) {
    const b = this.pbox[player]; if (!b.rect) return '';
    const sp = [...b.spans].sort((x, y) => x[0] - y[0]).map(([a, z]) => `${a + 1}–${z === null ? 'end' : z + 1}`);
    return sp.length ? `frames ${sp.join(', ')}` : 'switched off';
  }

  // ---------- point labeler ----------
  ptSnap() { this.ptHist.push(JSON.stringify(this.pts)); if (this.ptHist.length > 100) this.ptHist.shift(); }
  undoPts() { if (!this.ptHist.length) return false; this.pts = JSON.parse(this.ptHist.pop()); this.ptDraft = null; this.ptChanged(); return true; }
  ptChanged() { this.ptVer++; this.app.requestRender(); this.app.onPaneChange(this, true); }
  keyFrames(key) { const s = this.pts[key]; return s ? Object.keys(s.kf).map(Number).sort((a, b) => a - b) : []; }
  // Points of a set on frame f: { pts, key } (key = a frame you placed). Held forward until Finish, blended between keyframes.
  setPoints(key, f) {
    const s = this.pts[key], ks = this.keyFrames(key);
    if (!s || !ks.length || f < ks[0] || (s.end !== null && f > s.end)) return null;
    let i = ks.length - 1; while (ks[i] > f) i--;
    const a = s.kf[ks[i]];
    if (ks[i] === f) return { pts: a, key: true };
    if (i === ks.length - 1) return { pts: a, key: false };
    const b = s.kf[ks[i + 1]], t = (f - ks[i]) / (ks[i + 1] - ks[i]);
    return { pts: a.map((p, j) => [p[0] + (b[j][0] - p[0]) * t, p[1] + (b[j][1] - p[1]) * t]), key: false };
  }
  // Like setPoints, but the Arm set takes its shoulder from the Shoulders set when that has points on this frame.
  livePts(key, f) {
    const cur = this.setPoints(key, f); if (!cur) return null;
    if (key !== 'arm') return cur;
    const sh = this.setPoints('shoulders', f); if (!sh) return cur;
    const pts = cur.pts.map((q) => [q[0], q[1]]); pts[0] = [sh.pts[0][0], sh.pts[0][1]];
    return { pts, key: cur.key, linked: true };
  }
  // Which point of a set the next click places on frame f.
  ptNextIndex(key, f) {
    if (this.ptDraft && this.ptDraft.key === key && this.ptDraft.f === f) return this.ptDraft.pts.length;
    return key === 'arm' && this.setPoints('shoulders', f) ? 1 : 0;
  }
  ensureKey(key, f) {
    const s = this.pts[key]; if (!s) return null;
    if (s.kf[f]) return s.kf[f];
    const cur = this.setPoints(key, f); if (!cur) return null;
    s.kf[f] = cur.pts.map((p) => [p[0], p[1]]);
    return s.kf[f];
  }
  // ---- move / rotate the whole set (center dot and rotate pin) ----
  // Video-pixel geometry of the handles: the center dot (moves the line) and the pin that drops from the pivot (rotates it).
  handleGeom(key, pts, u) {
    const W = this.vsz.W, H = this.vsz.H, P = pts.map((q) => [q[0] * W, q[1] * H]);
    let center, pivot;
    if (key === 'arm') { center = [(P[1][0] + P[2][0] + P[3][0]) / 3, (P[1][1] + P[2][1] + P[3][1]) / 3]; pivot = P[0]; }
    else { center = [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2]; pivot = center; }
    return { center, pivot, pin: [pivot[0], pivot[1] + PIN_LEN * u] };
  }
  hitHandle(e, key, f) {
    const cur = this.livePts(key, f); if (!cur) return null;
    const v = this.vw, sc = this.k * v.z, u = this.vsz.W / 1280 / v.z, [cx, cy] = this.canvasXY(e), g = this.handleGeom(key, cur.pts, u);
    const near = (p, r) => Math.hypot(p[0] * sc + v.tx - cx, p[1] * sc + v.ty - cy) / this.dpr <= r;
    if (this.app.state.prot && near(g.pin, 15)) return 'rot';
    return near(g.center, 14) ? 'move' : null;
  }
  // Which points slide, which turn, and the pivot (normalized) for one keyframe of a set.
  dragInfo(key, fr) {
    const cur = this.livePts(key, fr), P = cur.pts;
    if (key === 'arm') return { mv: cur.linked ? [1, 2, 3] : [0, 1, 2, 3], rt: [1, 2, 3], pivot: [P[0][0], P[0][1]] };
    return { mv: [0, 1], rt: [0, 1], pivot: [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2] };
  }
  startXform(mode, key, f, q, e) {
    const whole = !!this.app.state.pwhole, s = this.pts[key], W = this.vsz.W, H = this.vsz.H;
    this.ptSnap();
    const orig = {};
    for (const fr of whole ? this.keyFrames(key) : [f]) {
      const kf = whole ? s.kf[fr] : this.ensureKey(key, fr);
      if (!kf) continue;
      orig[fr] = { pts: kf.map((p) => [p[0], p[1]]), ...this.dragInfo(key, fr) };
    }
    if (!Object.keys(orig).length) { this.ptHist.pop(); return; }
    const piv = (orig[f] || Object.values(orig)[0]).pivot;
    this.pdrag = { key, mode, f, q0: q, orig, a0: Math.atan2((q[1] - piv[1]) * H, (q[0] - piv[0]) * W), delta: 0 };
    try { this.cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    this.cv.style.cursor = mode === 'rot' ? 'crosshair' : 'move';
    this.ptChanged();
  }
  applyXform(e) {
    const d = this.pdrag, q = this.pt(e), W = this.vsz.W, H = this.vsz.H, s = this.pts[d.key], c01 = (n) => Math.min(1, Math.max(0, n));
    if (!s) return;
    const piv = (d.orig[d.f] || Object.values(d.orig)[0]).pivot;
    if (d.mode === 'rot') { let a = Math.atan2((q[1] - piv[1]) * H, (q[0] - piv[0]) * W) - d.a0; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; d.delta = a; }
    const cs = Math.cos(d.delta), sn = Math.sin(d.delta);
    for (const fr of Object.keys(d.orig)) {
      const o = d.orig[fr], kf = s.kf[fr]; if (!kf) continue;
      if (d.mode === 'move') {
        const dx = q[0] - d.q0[0], dy = q[1] - d.q0[1];
        o.mv.forEach((i) => { kf[i] = [c01(o.pts[i][0] + dx), c01(o.pts[i][1] + dy)]; });
      } else {
        o.rt.forEach((i) => {
          const rx = (o.pts[i][0] - o.pivot[0]) * W, ry = (o.pts[i][1] - o.pivot[1]) * H;
          kf[i] = [c01(o.pivot[0] + (rx * cs - ry * sn) / W), c01(o.pivot[1] + (rx * sn + ry * cs) / H)];
        });
      }
    }
    this.ptVer++; this.app.requestRender();
  }
  // Click or drag on the video while a point set is active.
  pointDown(e) {
    const key = this.app.state.pset, def = POINT_SETS[key]; if (!def) return;
    const f = Math.round(this.f), q = this.pt(e), cur = this.livePts(key, f);
    if (cur) {
      const hit = this.hitHandle(e, key, f);
      if (hit) { this.startXform(hit, key, f, q, e); return; }
      // Grab the nearest dot; a click far from any dot moves the nearest one there.
      const [cx, cy] = this.canvasXY(e), sc = this.k * this.vw.z, v = this.vw;
      let best = 0, bd = 1e9;
      cur.pts.forEach((p, j) => { if (cur.linked && j === 0) return; const d = Math.hypot(p[0] * this.vsz.W * sc + v.tx - cx, p[1] * this.vsz.H * sc + v.ty - cy) / this.dpr; if (d < bd) { bd = d; best = j; } });
      this.ptSnap();
      const kf = this.ensureKey(key, f);
      if (!kf) { this.ptHist.pop(); return; }
      if (bd > 30) kf[best] = [q[0], q[1]];
      this.pdrag = { key, idx: best, f };
      try { this.cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      this.ptChanged();
      return;
    }
    const s = this.pts[key];
    if (s && s.end !== null) { this.app.toast(`${def.label} is finished. Press Edit to change it.`); return; }
    if (!this.ptDraft || this.ptDraft.key !== key || this.ptDraft.f !== f) {
      this.ptDraft = { key, f, pts: [] };
      const sh = key === 'arm' ? this.setPoints('shoulders', f) : null; // the arm starts at the shoulder you already placed
      if (sh) this.ptDraft.pts.push([sh.pts[0][0], sh.pts[0][1]]);
    }
    this.ptDraft.pts.push([q[0], q[1]]);
    if (this.ptDraft.pts.length === def.roles.length) {
      this.ptSnap();
      if (!this.pts[key]) this.pts[key] = { kf: {}, end: null };
      this.pts[key].kf[f] = this.ptDraft.pts; this.ptDraft = null;
      this.ptChanged();
    } else this.app.requestRender();
  }
  // Finish (lock the range from the first keyframe to this frame) or reopen a finished set.
  toggleDone(key) {
    const s = this.pts[key]; if (!s) return 'none';
    if (s.end !== null) { this.ptSnap(); s.end = null; this.ptChanged(); return 'reopened'; }
    const f = Math.round(this.f), ks = this.keyFrames(key);
    if (f < ks[0]) return 'early';
    this.ptSnap(); this.ensureKey(key, f); s.end = f; this.ptChanged();
    return 'done';
  }
  // Fill this frame's points from the tracker's skeleton, to drag from there.
  seedFromTracker(key) {
    const def = POINT_SETS[key], f = Math.round(this.f), base = this.smoothed?.[f], hand = this.app.state.hand;
    if (!base) return 'none';
    const pts = [];
    for (const r of def.roles) { const i = roleIndex(r, hand) * 3; if (base[i + 2] < 0.3) return 'none'; pts.push([base[i], base[i + 1]]); }
    const s = this.pts[key];
    if (s && s.end !== null && (f > s.end || f < this.keyFrames(key)[0])) return 'finished';
    this.ptSnap();
    if (!this.pts[key]) this.pts[key] = { kf: {}, end: null };
    this.pts[key].kf[f] = pts; this.ptDraft = null; this.ptChanged();
    return 'ok';
  }
  clearSet(key) { if (!this.pts[key]) return; this.ptSnap(); delete this.pts[key]; this.ptDraft = null; this.ptChanged(); }

  drawManual(ctx, W, H, f, u, st) {
    for (const k of POINT_SET_ORDER) {
      const def = POINT_SETS[k], cur = this.livePts(k, f);
      const P = cur ? cur.pts : (this.ptDraft && this.ptDraft.key === k && this.ptDraft.f === f ? this.ptDraft.pts : null);
      if (!P) continue;
      const px = P.map((p) => [p[0] * W, p[1] * H]), live = st.pset === k;
      ctx.save();
      ctx.lineCap = 'round';
      const nseg = def.chain ? px.length - 1 : Math.min(1, px.length - 1);
      for (let i = 0; i < nseg; i++) {
        ctx.strokeStyle = def.segColors ? def.segColors[i] : def.color; ctx.lineWidth = (live ? 5 : 4) * u;
        ctx.beginPath(); ctx.moveTo(px[i][0], px[i][1]); ctx.lineTo(px[i + 1][0], px[i + 1][1]); ctx.stroke();
      }
      px.forEach(([x, y], i) => {
        const col = def.segColors ? def.segColors[Math.max(0, i - 1)] : def.color;
        ctx.beginPath(); ctx.arc(x, y, (cur && cur.key ? 8 : 6) * u * (live ? 1.15 : 1), 0, Math.PI * 2);
        if (cur && cur.key) { ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2.5 * u; ctx.strokeStyle = '#fff'; ctx.stroke(); }
        else { ctx.fillStyle = '#0b0f0e'; ctx.fill(); ctx.lineWidth = 3 * u; ctx.strokeStyle = col; ctx.stroke(); }
      });
      if (live && cur) {
        const g = this.handleGeom(k, P, u), dr = this.pdrag && this.pdrag.key === k && this.pdrag.mode === 'rot' ? this.pdrag.delta : 0;
        const ring = (x, y, r, fill) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); if (fill) { ctx.fillStyle = fill; ctx.fill(); } ctx.lineWidth = 2.5 * u; ctx.strokeStyle = '#fff'; ctx.stroke(); };
        ctx.save(); ctx.globalAlpha = 0.95;
        ring(g.center[0], g.center[1], 10 * u, 'rgba(11,15,14,.45)');
        ctx.beginPath(); ctx.arc(g.center[0], g.center[1], 2.5 * u, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
        if (st.prot) {
          const hx = g.pivot[0] - Math.sin(dr) * PIN_LEN * u, hy = g.pivot[1] + Math.cos(dr) * PIN_LEN * u;
          ctx.lineWidth = 2.5 * u; ctx.strokeStyle = '#fff'; ctx.setLineDash([6 * u, 5 * u]);
          ctx.beginPath(); ctx.moveTo(g.pivot[0], g.pivot[1]); ctx.lineTo(hx, hy); ctx.stroke(); ctx.setLineDash([]);
          ring(hx, hy, 10 * u, def.color);
          if (this.pdrag && this.pdrag.mode === 'rot') { const dg = (dr * 180) / Math.PI; tag(ctx, (dg > 0 ? '+' : '') + dg.toFixed(1) + '°', hx + 52 * u, hy, u); }
        }
        ctx.restore();
      }
      if (cur && !def.chain && px.length === 2) {
        const v = computeMetric(def.metric, this.poseFrame(f), this.media, st.hand, st.dir);
        if (v !== null) tag(ctx, METRIC_DEFS[def.metric].fmt(v), (px[0][0] + px[1][0]) / 2, Math.min(px[0][1], px[1][1]) - 26 * u, u);
      } else if (cur && def.chain && px.length === 4) {
        const fr = this.poseFrame(f);
        const ve = computeMetric('elbow', fr, this.media, st.hand, st.dir), vw = computeMetric('wristBend', fr, this.media, st.hand, st.dir);
        if (ve !== null) tag(ctx, METRIC_DEFS.elbow.fmt(ve), px[1][0] + 44 * u, px[1][1] - 20 * u, u);
        if (vw !== null) tag(ctx, METRIC_DEFS.wristBend.fmt(vw), px[2][0] + 44 * u, px[2][1] + 22 * u, u);
      }
      ctx.restore();
    }
  }

  metric(key, f = Math.round(this.f)) {
    const fr = this.poseFrame(f);
    if (!fr || !this.media) return null;
    return computeMetric(key, fr, this.media, this.app.state.hand, this.app.state.dir);
  }

  // ---------- drawing state ----------
  snap() { this.hist.push(JSON.stringify(this.ann)); if (this.hist.length > 100) this.hist.shift(); }
  undo() { if (this.hist.length) { this.ann = JSON.parse(this.hist.pop()); this.pathAnn = null; this.app.requestRender(); this.app.onPaneChange(this, true); } }
  clearAnn() { if (this.ann.length) { this.snap(); this.ann = []; this.pathAnn = null; this.app.requestRender(); this.app.onPaneChange(this, true); } }
  finishPath() { this.pathAnn = null; }

  // ---------- zoom / pan ----------
  canvasXY(e) {
    const r = this.cv.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * this.cv.width, ((e.clientY - r.top) / r.height) * this.cv.height];
  }
  // Size the viewing window and its canvas, then keep the zoom state valid.
  layout() {
    if (!this.cv) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = this.view.clientWidth || 640;
    const maxH = Math.max(260, window.innerHeight - (window.innerWidth <= 1000 ? 200 : 300));
    const want = this.media ? (cw * this.vsz.H) / this.vsz.W : (cw * 9) / 16;
    const h = Math.round(Math.min(maxH, Math.max(200, want)));
    if (this.view.style.height !== h + 'px') this.view.style.height = h + 'px';
    const bw = Math.round(cw * this.dpr), bh = Math.round(h * this.dpr);
    if (this.cv.width !== bw || this.cv.height !== bh) { this.cv.width = bw; this.cv.height = bh; }
    this.k = Math.min(bw / this.vsz.W, bh / this.vsz.H);
    this.clampView(); this.app.requestRender();
  }
  clampView() {
    const v = this.vw, cw = this.cv.width, ch = this.cv.height;
    v.z = Math.min(16, Math.max(1, v.z));
    const sw = this.vsz.W * this.k * v.z, sh = this.vsz.H * this.k * v.z;
    // A side smaller than the window is centered; a larger side can pan but never past the video edge.
    v.tx = sw <= cw ? (cw - sw) / 2 : Math.min(0, Math.max(cw - sw, v.tx));
    v.ty = sh <= ch ? (ch - sh) / 2 : Math.min(0, Math.max(ch - sh, v.ty));
  }
  zoomAt(cx, cy, nz) {
    if (!this.media || this.vw.hold) return;
    const v = this.vw, z0 = v.z;
    const z1 = Math.min(16, Math.max(1, nz)), r = z1 / z0;
    v.z = z1; v.tx = cx - (cx - v.tx) * r; v.ty = cy - (cy - v.ty) * r;
    this.clampView(); this.syncZoom(); this.app.requestRender();
  }
  zoomCenter(nz) { this.zoomAt(this.cv.width / 2, this.cv.height / 2, nz); }
  fit() {
    if (!this.media || this.vw.hold) return;
    Object.assign(this.vw, { z: 1, tx: 0, ty: 0 }); this.clampView(); this.syncZoom(); this.app.requestRender();
  }
  setHold(on) { this.vw.hold = !!on; this.syncZoom(); }
  endPan() { if (this.pan) { this.pan = null; this.cv.style.cursor = ''; } }
  syncZoom() {
    if (!this.zc) return;
    const v = this.vw;
    this.zc.hidden = !this.media;
    this.zRead.textContent = Math.round(v.z * 100) + '%';
    this.zSlider.value = String(Math.round(25 * Math.log2(v.z)));
    this.zc.querySelector('[data-z=hold]').setAttribute('aria-pressed', String(v.hold));
    this.zc.classList.toggle('held', v.hold);
    for (const c of this.zc.querySelectorAll('[data-z=in],[data-z=out],[data-z=fit],input')) c.disabled = v.hold;
    this.view.classList.toggle('zoomed', v.z > 1.001);
  }

  pt(e) {
    const [cx, cy] = this.canvasXY(e), v = this.vw, sc = this.k * v.z;
    const c = (n) => Math.min(1, Math.max(0, n));
    return [c((cx - v.tx) / sc / this.vsz.W), c((cy - v.ty) / sc / this.vsz.H)];
  }

  commit(d) {
    const st = this.app.state;
    const rect = () => {
      const [a, b] = [d.pts[0], d.pts[1]];
      return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
    };
    if (d.type === 'pbox') {
      const r = rect();
      if (r.w < 0.01 || r.h < 0.01) return;
      const pl = this.slot.player; this.pbox[pl].rect = r; this.pboxOn(pl, Math.round(this.f));
      return;
    }
    if (d.type === 'roi' || d.type === 'lens') {
      const r = rect();
      if (r.w < 0.01 || r.h < 0.01) return;
      this[d.type] = r;
      this.app.onPaneChange(this, true);
      return;
    }
    this.snap();
    const keepFrame = d.type === 'board' ? null : (st.pin === 'frame' ? Math.round(this.f) : null);
    this.ann.push({ type: d.type, pts: d.pts.slice(0, d.type === 'angle' ? 3 : d.pts.length), color: st.color, w: st.w, frame: keepFrame });
    this.app.onPaneChange(this, true);
  }

  eraseAt(q) {
    const W = this.vsz.W, H = this.vsz.H, x = q[0] * W, y = q[1] * H, f = Math.round(this.f);
    let best = -1, bd = (30 * (W / 1280)) / this.vw.z;
    this.ann.forEach((a, i) => {
      if (a.frame !== null && a.frame !== f) return;
      const d = annDist(a, x, y, W, H);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) { this.snap(); this.ann.splice(best, 1); this.pathAnn = null; this.app.requestRender(); this.app.onPaneChange(this, true); }
  }

  onDown(e) {
    const st = this.app.state, t = st.tool;
    if (!this.media) return;
    // Two fingers on a touch screen: pinch to zoom, drag to pan.
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === 'touch' && this.ptrs.size === 2) {
      e.preventDefault(); this.draft = null; this.endPan();
      const [a, b] = [...this.ptrs.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    // Pan: middle or right button, Alt/Shift+drag, or any drag with the cursor tool. Only when zoomed in and not on hold.
    if (e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || e.shiftKey || (t === 'cursor' && !st.pset)))) {
      e.preventDefault();
      if (this.vw.hold || this.vw.z <= 1.001) return;
      this.pan = { x: e.clientX, y: e.clientY };
      try { this.cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      this.cv.style.cursor = 'grabbing';
      return;
    }
    if (st.pset && e.button === 0) { e.preventDefault(); this.pointDown(e); return; }
    if (t === 'cursor' || e.button > 0) return;
    e.preventDefault();
    const q = this.pt(e);
    if (t === 'eraser') { this.eraseAt(q); return; }
    if (t === 'plumb' || t === 'level') {
      this.commit({ type: 'line', pts: t === 'plumb' ? [[q[0], 0], [q[0], 1]] : [[0, q[1]], [1, q[1]]] });
      return;
    }
    if (t === 'path') {
      if (!this.pathAnn) {
        this.snap();
        this.pathAnn = { type: 'path', pts: [], color: st.color, w: st.w, frame: null };
        this.ann.push(this.pathAnn);
      }
      this.pathAnn.pts.push([q[0], q[1], Math.round(this.f)]);
      this.app.requestRender(); this.app.onPaneChange(this, true);
      return;
    }
    const multi = t === 'angle' ? 3 : t === 'board' ? 4 : 0;
    if (multi) {
      if (!this.draft || this.draft.type !== t) this.draft = { type: t, pts: [q], live: q };
      else {
        this.draft.pts.push(q); this.draft.live = q;
        if (this.draft.pts.length === multi) { const d = this.draft; this.draft = null; this.commit(d); }
      }
    } else {
      this.draft = { type: t, pts: [q], live: q, drag: true };
      try { this.cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }
    this.app.requestRender();
  }

  onMove(e) {
    if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()], r = this.cv.getBoundingClientRect(), v = this.vw;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (!v.hold) {
        v.tx += ((mx - this.pinch.mx) / r.width) * this.cv.width; v.ty += ((my - this.pinch.my) / r.height) * this.cv.height;
        this.zoomAt(((mx - r.left) / r.width) * this.cv.width, ((my - r.top) / r.height) * this.cv.height, v.z * (d / this.pinch.d));
      }
      Object.assign(this.pinch, { d, mx, my });
      return;
    }
    if (this.pdrag && this.pdrag.mode) { this.applyXform(e); return; }
    if (this.pdrag) {
      const kf = this.pts[this.pdrag.key]?.kf[this.pdrag.f], q = this.pt(e);
      if (kf) { kf[this.pdrag.idx] = [q[0], q[1]]; this.ptVer++; this.app.requestRender(); }
      return;
    }
    if (this.pan) {
      const r = this.cv.getBoundingClientRect(), v = this.vw;
      v.tx += ((e.clientX - this.pan.x) / r.width) * this.cv.width;
      v.ty += ((e.clientY - this.pan.y) / r.height) * this.cv.height;
      this.pan.x = e.clientX; this.pan.y = e.clientY;
      this.clampView(); this.app.requestRender();
      return;
    }
    const st = this.app.state;
    if (st.pset && !this.draft) { const h = this.hitHandle(e, st.pset, Math.round(this.f)); this.cv.style.cursor = h === 'move' ? 'move' : h === 'rot' ? 'crosshair' : ''; }
    if (!this.draft) return;
    const q = this.pt(e);
    this.draft.live = q;
    if (this.draft.type === 'pen') this.draft.pts.push(q);
    this.app.requestRender();
  }

  onUp(e) {
    const wasPinch = !!this.pinch;
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = null;
    if (wasPinch) return;
    if (this.pdrag) { const was = this.pdrag.mode; this.pdrag = null; if (was) this.cv.style.cursor = ''; this.ptChanged(); return; }
    if (this.pan) { this.endPan(); return; }
    const d = this.draft;
    if (!d || !d.drag) return;
    const q = this.pt(e);
    this.draft = null;
    if (d.type === 'pen') { if (d.pts.length > 2) this.commit(d); }
    else {
      d.pts.push(q);
      if (Math.hypot((q[0] - d.pts[0][0]) * this.vsz.W, (q[1] - d.pts[0][1]) * this.vsz.H) * this.k * this.vw.z / this.dpr > 8) this.commit(d);
    }
    this.app.requestRender();
  }

  // ---------- rendering ----------
  render() {
    const { ctx, cv } = this, st = this.app.state, W = this.vsz.W, H = this.vsz.H, v = this.vw, z = v.z, u = W / 1280 / z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0e0d'; ctx.fillRect(0, 0, cv.width, cv.height);
    if (!this.media) { this.tc.textContent = ''; return; }
    const f = Math.round(this.f);
    if (this.media.type === 'video' && !this.analyzing) this.ensureSeek();
    // Everything below is drawn in video coordinates under the zoom/pan transform.
    const sc = this.k * z;
    ctx.setTransform(sc, 0, 0, sc, v.tx, v.ty);
    ctx.drawImage(this.media.el, 0, 0, W, H);
    if (TRACKER_UI) this.drawBody(ctx, W, H, f, st);
    if (this.ptDraft && this.ptDraft.f !== f) this.ptDraft = null;
    this.drawManual(ctx, W, H, f, u, st);
    for (const a of this.ann) if (a.frame === null || a.frame === f) drawAnn(ctx, a, W, H, f, z);
    if (this.draft) this.drawDraft(ctx, W, H, f, st);
    if (TRACKER_UI && st.layers.roi) {
      // Once tracking exists the box belongs to the tracked frames only (it is the box used on that frame).
      let box = null;
      if (this.hasTracking()) { if (this.tr[f]) box = this.boxes[f]; else if (st.tool === 'roi') box = this.roi; } else box = this.roi;
      if (box) this.drawBox(ctx, box, W, H, u, 'Player', AMBER);
    }
    for (const pl of [1, 2]) if (this.pboxVisible(pl, f)) this.drawBox(ctx, this.pbox[pl].rect, W, H, u, `Player ${pl}`, PLAYER_COLORS[pl]);
    if (this.lens && st.layers.lens) this.drawLens(ctx, W, H, u);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const trk = TRACKER_UI && this.hasTracking() ? (this.tr[f] ? ' · tracked' : ' · not tracked') : '';
    this.tc.textContent = this.media.type === 'image' ? 'Photo' + trk : `F ${f + 1} / ${this.N} · ${(f / this.fps).toFixed(3)} s${trk}`;
  }

  drawDraft(ctx, W, H, f, st) {
    const d = this.draft;
    if (d.type === 'roi' || d.type === 'lens' || d.type === 'pbox') {
      const a = d.pts[0], b = d.live;
      this.drawBox(ctx, { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }, W, H, W / 1280 / this.vw.z, d.type === 'pbox' ? `Player ${this.slot.player}` : d.type === 'roi' ? 'Player' : 'Zoom', d.type === 'pbox' ? PLAYER_COLORS[this.slot.player] : d.type === 'roi' ? AMBER : '#fff');
      return;
    }
    let pts;
    if (d.type === 'angle' || d.type === 'board') pts = [...d.pts, d.live];
    else if (d.type === 'pen') pts = d.pts;
    else pts = [d.pts[0], d.live];
    drawAnn(ctx, { type: d.type, pts, color: st.color, w: st.w, frame: null }, W, H, f, this.vw.z);
  }

  drawBox(ctx, r, W, H, u, label, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 3 * u; ctx.setLineDash([12 * u, 8 * u]);
    ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
    ctx.setLineDash([]);
    ctx.font = `600 ${Math.round(18 * u)}px 'JetBrains Mono', monospace`;
    const tw = ctx.measureText(label).width + 12 * u;
    ctx.fillStyle = color; ctx.fillRect(r.x * W, r.y * H - 24 * u, tw, 24 * u);
    ctx.fillStyle = '#111'; ctx.textBaseline = 'middle'; ctx.fillText(label, r.x * W + 6 * u, r.y * H - 11 * u);
    ctx.restore();
  }

  drawLens(ctx, W, H, u) {
    const L = this.lens, v = this.vw, cv = this.cv, sx = L.x * W, sy = L.y * H, sw = L.w * W, sh = L.h * H;
    ctx.save();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * u; ctx.strokeRect(sx, sy, sw, sh);
    // The corner window is drawn in screen space, copying what is currently visible inside the box.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sc = this.k * v.z, d = this.dpr;
    const mx = sx * sc + v.tx, my = sy * sc + v.ty, mw = sw * sc, mh = sh * sc;
    let iw = cv.width * 0.3, ih = (iw * sh) / sw;
    if (ih > cv.height * 0.5) { ih = cv.height * 0.5; iw = (ih * sw) / sh; }
    const ix = cv.width - iw - 16 * d, iy = cv.height - ih - 16 * d;
    if (mw > 1 && mh > 1 && mx < cv.width && my < cv.height && mx + mw > 0 && my + mh > 0) {
      this.tmp.width = Math.max(1, Math.round(iw)); this.tmp.height = Math.max(1, Math.round(ih));
      this.tmp.getContext('2d').drawImage(cv, mx, my, mw, mh, 0, 0, this.tmp.width, this.tmp.height);
      ctx.drawImage(this.tmp, ix, iy);
      ctx.lineWidth = 3 * d; ctx.strokeRect(ix, iy, iw, ih);
    }
    ctx.restore();
  }

  drawBody(ctx, W, H, f, st) {
    const L = st.layers;
    const fr = this.poseFrame(f);
    if (!fr) return;
    const hand = st.hand, u = W / 1280 / this.vw.z;
    const col = COL[this.id];
    const P = (i) => [fr[i * 3] * W, fr[i * 3 + 1] * H, fr[i * 3 + 2]];
    if (L.trail && this.smoothed) {
      const wi = throwingWristIndex(hand);
      ctx.save(); ctx.strokeStyle = AMBER; ctx.lineWidth = 3 * u; ctx.lineJoin = 'round'; ctx.beginPath();
      let started = false, a0 = f;
      while (a0 > 0 && this.tr?.[a0 - 1]) a0--; // the path of the tracked stretch this frame is in
      for (let i = a0; i <= f; i++) {
        const o = this.smoothed[i];
        if (!o || o[wi * 3 + 2] < 0.3) continue;
        const x = o[wi * 3] * W, y = o[wi * 3 + 1] * H;
        if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
      }
      ctx.stroke(); ctx.restore();
    }
    if (L.skeleton) {
      ctx.save(); ctx.lineCap = 'round';
      const armSet = hand === 'R' ? ARM_R : ARM_L;
      for (const [a, b] of BONES) {
        const pa = P(a), pb = P(b);
        if (pa[2] < 0.3 || pb[2] < 0.3) continue;
        const isArm = armSet.has(`${a}-${b}`);
        ctx.strokeStyle = isArm ? AMBER : col;
        ctx.globalAlpha = isArm ? 1 : 0.8;
        ctx.lineWidth = (isArm ? 5 : 4) * u;
        ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
      }
      const n = P(0);
      if (n[2] >= 0.3) { ctx.globalAlpha = 0.8; ctx.strokeStyle = col; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(n[0], n[1], 9 * u, 0, Math.PI * 2); ctx.stroke(); }
      if (L.joints) {
        ctx.globalAlpha = 1; ctx.lineWidth = 2 * u;
        for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
          const p = P(i); if (p[2] < 0.3) continue;
          const wr = i === throwingWristIndex(hand);
          ctx.fillStyle = wr ? AMBER : '#0b0f0e'; ctx.strokeStyle = wr ? '#0b0f0e' : col;
          ctx.beginPath(); ctx.arc(p[0], p[1], (wr ? 6.5 : 4.5) * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();
    }
    if (L.labels) {
      const sh = P(roleIndex('sh', hand)), el = P(roleIndex('el', hand)), wr = P(roleIndex('wr', hand));
      if (sh[2] >= 0.3 && el[2] >= 0.3 && wr[2] >= 0.3) {
        ctx.save(); ctx.fillStyle = '#fff'; ctx.font = `600 ${Math.round(18 * u)}px 'JetBrains Mono', monospace`;
        ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 4;
        ctx.fillText(Math.round(angle3(sh, el, wr)) + '°', el[0] + 10 * u, el[1] - 8 * u);
        ctx.restore();
      }
    }
  }

  // PNG of the visible part of the video (without the black window around it).
  snapshot(cb) {
    this.render();
    const v = this.vw, cv = this.cv, sc = this.k * v.z;
    const x0 = Math.max(0, v.tx), y0 = Math.max(0, v.ty);
    const x1 = Math.min(cv.width, v.tx + this.vsz.W * sc), y1 = Math.min(cv.height, v.ty + this.vsz.H * sc);
    const w = Math.max(1, Math.round(x1 - x0)), h = Math.max(1, Math.round(y1 - y0));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(cv, x0, y0, w, h, 0, 0, w, h);
    c.toBlob(cb, 'image/png');
  }

  // ---------- save / load ----------
  toJSON() {
    return {
      name: this.nameEl.textContent, fps: this.fps, N: this.N, size: this.media ? [this.media.w, this.media.h] : null,
      ann: this.ann, rel: this.rel, roi: this.roi, lens: this.lens, pbox: this.pbox, slot: this.slot, nThrows: this.nThrows, slots: this.slots,
      pose: this.raw && this.trCount ? {
        info: this.poseInfo, frames: packFrames(this.raw), ranges: this.ranges(),
        boxes: this.boxes.map((b) => (b ? [b.x, b.y, b.w, b.h].map((v) => Math.round(v * 10000) / 10000) : null))
      } : null
    };
  }
  fromJSON(d) {
    this.ann = d.ann || []; this.hist = []; this.rel = d.rel ?? null; this.roi = d.roi || null; this.lens = d.lens || null;
    this.resetSlots();
    if (d.pbox) for (const n of [1, 2]) { const q = d.pbox[n]; if (q && q.rect) this.pbox[n] = { rect: q.rect, spans: (q.spans || []).filter((s) => Array.isArray(s)) }; }
    if (d.slots) { this.slots = d.slots; this.slot = d.slot || { player: 1, throw: 1 }; this.nThrows = Math.max(4, d.nThrows || 4, this.slot.throw); }
    else if (d.pts) this.slotData('1-1').pts = d.pts; // older saves (before Player / Throw slots)
    if (d.pose?.frames) this.setPose(unpackFrames(d.pose.frames), d.pose.info, { ranges: d.pose.ranges, boxes: d.pose.boxes });
  }
}

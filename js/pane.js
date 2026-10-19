// One video (or photo) pane: media, frame stepping, drawing, body overlay.
import { drawAnn, annDist } from './annotate.js';
import { COL, FPS_CHOICES } from './config.js';
import { smoothFrames, packFrames, unpackFrames } from './pose.js';
import { roleIndex, throwingWristIndex, computeMetric, angle3 } from './metrics.js';

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

export class Pane {
  constructor(id, app) {
    this.id = id; this.app = app;
    this.media = null; this.url = null;
    this.f = 0; this.N = 0; this.fps = 30; this.fpsSource = 'default';
    this.ann = []; this.hist = []; this.draft = null; this.pathAnn = null;
    this.rel = null; this.roi = null; this.lens = null;
    this.raw = null; this.smoothed = null; this.poseInfo = null;
    this.analyzing = false; this.seeking = false;
    // View (zoom/pan) in canvas pixels: screen = point * z + (tx, ty). hold locks it.
    this.vw = { z: 1, tx: 0, ty: 0, hold: false }; this.pan = null;
    this.ptrs = new Map(); this.pinch = null;
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
    el.addEventListener('pointerdown', () => { if (this.app.state.active !== this.id) this.app.setActive(this.id); }, true);
    this.cv.addEventListener('pointerdown', (e) => this.onDown(e));
    this.cv.addEventListener('pointermove', (e) => this.onMove(e));
    this.cv.addEventListener('pointerup', (e) => this.onUp(e));
    this.cv.addEventListener('pointercancel', (e) => { this.ptrs.delete(e.pointerId); this.pinch = null; this.draft = null; this.endPan(); this.app.requestRender(); });
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
    this.url = null; this.media = null;
  }

  async loadFile(file) {
    this.release();
    this.nameEl.textContent = file.name;
    this.metaEl.textContent = 'Loading…';
    const url = URL.createObjectURL(file);
    this.url = url;
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
        const fps = await detectFps(v);
        if (fps) { this.fps = fps; this.fpsSource = 'detected'; } else { this.fps = this.app.state.fps; this.fpsSource = 'default'; }
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
    this.cv.width = Math.round(this.media.w * s); this.cv.height = Math.round(this.media.h * s);
    this.f = 0; this.ann = []; this.hist = []; this.rel = null; this.roi = null; this.lens = null;
    this.raw = null; this.smoothed = null; this.poseInfo = null; this.draft = null; this.pathAnn = null;
    this.vw = { z: 1, tx: 0, ty: 0, hold: false }; this.pan = null; this.syncZoom();
    this.emptyEl.hidden = true;
    this.updateMeta();
    if (this.media.type === 'video') await this.seekTo(0);
    this.app.onMediaLoaded(this);
  }

  updateMeta() {
    if (!this.media) { this.metaEl.textContent = ''; return; }
    const m = this.media;
    this.metaEl.textContent = m.type === 'image'
      ? `${m.w}×${m.h} photo`
      : `${m.w}×${m.h} · ${this.fps} fps${this.fpsSource === 'detected' ? '' : ' (assumed)'}`;
  }

  setFps(fps) {
    if (this.media?.type !== 'video') return;
    this.fps = fps; this.fpsSource = 'set';
    this.N = Math.max(1, Math.round(this.media.dur * fps));
    this.f = Math.min(this.f, this.N - 1);
    this.raw = null; this.smoothed = null; this.poseInfo = null;
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
  setPose(raw, info) {
    this.raw = raw; this.poseInfo = info || null;
    this.rebuildSmooth();
  }
  rebuildSmooth() { this.smoothed = this.raw ? smoothFrames(this.raw, this.app.state.smooth) : null; }
  poseFrame(f = Math.round(this.f)) { return this.smoothed ? this.smoothed[f] || null : null; }
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
  clampView() {
    const v = this.vw, W = this.cv.width, H = this.cv.height;
    v.z = Math.min(16, Math.max(1, v.z));
    v.tx = Math.min(0, Math.max(W * (1 - v.z), v.tx));
    v.ty = Math.min(0, Math.max(H * (1 - v.z), v.ty));
  }
  zoomAt(cx, cy, nz) {
    if (!this.media || this.vw.hold) return;
    const v = this.vw, z0 = v.z;
    v.z = nz; this.clampView();
    const k = v.z / z0;
    v.tx = cx - (cx - v.tx) * k; v.ty = cy - (cy - v.ty) * k;
    this.clampView(); this.syncZoom(); this.app.requestRender();
  }
  zoomCenter(nz) { this.zoomAt(this.cv.width / 2, this.cv.height / 2, nz); }
  fit() {
    if (!this.media || this.vw.hold) return;
    Object.assign(this.vw, { z: 1, tx: 0, ty: 0 }); this.syncZoom(); this.app.requestRender();
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
    const [cx, cy] = this.canvasXY(e), v = this.vw;
    const c = (n) => Math.min(1, Math.max(0, n));
    return [c((cx - v.tx) / v.z / this.cv.width), c((cy - v.ty) / v.z / this.cv.height)];
  }

  commit(d) {
    const st = this.app.state;
    const rect = () => {
      const [a, b] = [d.pts[0], d.pts[1]];
      return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
    };
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
    const W = this.cv.width, H = this.cv.height, x = q[0] * W, y = q[1] * H, f = Math.round(this.f);
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
    if (e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || e.shiftKey || t === 'cursor'))) {
      e.preventDefault();
      if (this.vw.hold || this.vw.z <= 1.001) return;
      this.pan = { x: e.clientX, y: e.clientY };
      try { this.cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      this.cv.style.cursor = 'grabbing';
      return;
    }
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
    if (this.pan) {
      const r = this.cv.getBoundingClientRect(), v = this.vw;
      v.tx += ((e.clientX - this.pan.x) / r.width) * this.cv.width;
      v.ty += ((e.clientY - this.pan.y) / r.height) * this.cv.height;
      this.pan.x = e.clientX; this.pan.y = e.clientY;
      this.clampView(); this.app.requestRender();
      return;
    }
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
    if (this.pan) { this.endPan(); return; }
    const d = this.draft;
    if (!d || !d.drag) return;
    const q = this.pt(e);
    this.draft = null;
    if (d.type === 'pen') { if (d.pts.length > 2) this.commit(d); }
    else {
      d.pts.push(q);
      if (Math.hypot((q[0] - d.pts[0][0]) * this.cv.width, (q[1] - d.pts[0][1]) * this.cv.height) * this.vw.z > 8) this.commit(d);
    }
    this.app.requestRender();
  }

  // ---------- rendering ----------
  render() {
    const { ctx, cv } = this, st = this.app.state, W = cv.width, H = cv.height, v = this.vw, z = v.z, u = W / 1280 / z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0e0d'; ctx.fillRect(0, 0, W, H);
    if (!this.media) { this.tc.textContent = ''; return; }
    const f = Math.round(this.f);
    if (this.media.type === 'video' && !this.analyzing) this.ensureSeek();
    // Everything below is drawn in video coordinates under the zoom/pan transform.
    ctx.setTransform(z, 0, 0, z, v.tx, v.ty);
    ctx.drawImage(this.media.el, 0, 0, W, H);
    this.drawBody(ctx, W, H, f, st);
    for (const a of this.ann) if (a.frame === null || a.frame === f) drawAnn(ctx, a, W, H, f, z);
    if (this.draft) this.drawDraft(ctx, W, H, f, st);
    if (this.roi && st.layers.roi) this.drawBox(ctx, this.roi, W, H, u, 'Player', AMBER);
    if (this.lens && st.layers.lens) this.drawLens(ctx, W, H, u);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.tc.textContent = this.media.type === 'image' ? 'Photo' : `F ${f + 1} / ${this.N} · ${(f / this.fps).toFixed(3)} s`;
  }

  drawDraft(ctx, W, H, f, st) {
    const d = this.draft;
    if (d.type === 'roi' || d.type === 'lens') {
      const a = d.pts[0], b = d.live;
      this.drawBox(ctx, { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }, W, H, W / 1280 / this.vw.z, d.type === 'roi' ? 'Player' : 'Zoom', d.type === 'roi' ? AMBER : '#fff');
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
    const L = this.lens, v = this.vw, sx = L.x * W, sy = L.y * H, sw = L.w * W, sh = L.h * H;
    ctx.save();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * u; ctx.strokeRect(sx, sy, sw, sh);
    // The corner window is drawn in screen space, copying what is currently visible inside the box.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const u0 = W / 1280;
    const mx = sx * v.z + v.tx, my = sy * v.z + v.ty, mw = sw * v.z, mh = sh * v.z;
    let iw = W * 0.36, ih = (iw * sh) / sw;
    if (ih > H * 0.6) { ih = H * 0.6; iw = (ih * sw) / sh; }
    const ix = W - iw - 16 * u0, iy = H - ih - 16 * u0;
    if (mw > 1 && mh > 1 && mx < W && my < H && mx + mw > 0 && my + mh > 0) {
      this.tmp.width = Math.max(1, Math.round(iw)); this.tmp.height = Math.max(1, Math.round(ih));
      this.tmp.getContext('2d').drawImage(this.cv, mx, my, mw, mh, 0, 0, this.tmp.width, this.tmp.height);
      ctx.drawImage(this.tmp, ix, iy);
      ctx.lineWidth = 3 * u0; ctx.strokeRect(ix, iy, iw, ih);
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
    if (L.trail) {
      const wi = throwingWristIndex(hand);
      ctx.save(); ctx.strokeStyle = AMBER; ctx.lineWidth = 3 * u; ctx.lineJoin = 'round'; ctx.beginPath();
      let started = false;
      for (let i = 0; i <= f; i++) {
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

  // ---------- save / load ----------
  toJSON() {
    return {
      name: this.nameEl.textContent, fps: this.fps, N: this.N, size: this.media ? [this.media.w, this.media.h] : null,
      ann: this.ann, rel: this.rel, roi: this.roi, lens: this.lens,
      pose: this.raw ? { info: this.poseInfo, frames: packFrames(this.raw) } : null
    };
  }
  fromJSON(d) {
    this.ann = d.ann || []; this.hist = []; this.rel = d.rel ?? null; this.roi = d.roi || null; this.lens = d.lens || null;
    if (d.pose?.frames) this.setPose(unpackFrames(d.pose.frames), d.pose.info);
  }
}

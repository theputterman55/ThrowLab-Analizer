// Body tracking with MediaPipe Pose Landmarker, running on the user's device.
// The runtime and models are vendored in /vendor and /models so nothing is uploaded anywhere.

const BASE = new URL('../', import.meta.url);
let mod = null;
let fileset = null;

async function getRuntime() {
  if (!mod) mod = await import(new URL('vendor/mediapipe/vision_bundle.mjs', BASE).href);
  if (!fileset) fileset = await mod.FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', BASE).href.replace(/\/$/, ''));
  return { mod, fileset };
}

export async function createLandmarker({ model = 'full', mode = 'VIDEO', numPoses = 3 }) {
  const { mod, fileset } = await getRuntime();
  const local = new URL(`models/pose_landmarker_${model}.task`, BASE).href;
  const remote = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${model}/float16/1/pose_landmarker_${model}.task`;
  let lastErr = null;
  for (const modelAssetPath of [local, remote]) {
    for (const delegate of ['GPU', 'CPU']) {
      try {
        return await mod.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath, delegate },
          runningMode: mode,
          numPoses,
          minPoseDetectionConfidence: 0.4,
          minPosePresenceConfidence: 0.4,
          minTrackingConfidence: 0.4
        });
      } catch (e) { lastErr = e; }
    }
  }
  throw lastErr || new Error('Could not start the body tracker.');
}

function toFrame(landmarks, map) {
  const out = new Float32Array(33 * 3);
  for (let i = 0; i < 33; i++) {
    const l = landmarks[i];
    const [x, y] = map(l.x, l.y);
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = l.visibility ?? 0;
  }
  return out;
}

export function bboxOf(frame) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0, n = 0;
  for (let i = 0; i < 33; i++) {
    if (frame[i * 3 + 2] < 0.3) continue;
    const x = frame[i * 3], y = frame[i * 3 + 1];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); n++;
  }
  return n ? { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, area: (x1 - x0) * (y1 - y0) } : null;
}

// Choose which detected person is the thrower.
export function pickPerson(people, prev, roi) {
  const cand = people.map((f) => ({ f, b: bboxOf(f) })).filter((c) => c.b);
  if (!cand.length) return null;
  if (prev) {
    cand.sort((a, b) => Math.hypot(a.b.cx - prev.cx, a.b.cy - prev.cy) - Math.hypot(b.b.cx - prev.cx, b.b.cy - prev.cy));
    const c = cand[0];
    if (Math.hypot(c.b.cx - prev.cx, c.b.cy - prev.cy) < 0.25) return c;
  }
  if (roi) {
    const rcx = roi.x + roi.w / 2, rcy = roi.y + roi.h / 2;
    cand.sort((a, b) => Math.hypot(a.b.cx - rcx, a.b.cy - rcy) - Math.hypot(b.b.cx - rcx, b.b.cy - rcy));
    return cand[0];
  }
  cand.sort((a, b) => b.b.area - a.b.area);
  return cand[0];
}

function cropCanvas(media, roi) {
  const rw = Math.max(8, roi.w * media.w), rh = Math.max(8, roi.h * media.h);
  const scale = Math.min(Math.max(1, 512 / Math.min(rw, rh)), 1280 / Math.max(rw, rh));
  const c = document.createElement('canvas');
  c.width = Math.round(rw * scale); c.height = Math.round(rh * scale);
  return { c, ctx: c.getContext('2d') };
}

// Move the Follow box so it stays centered on the person (k: 1 = jump, lower = glide). Size never changes.
export function followBox(box, bb, k = 0.7) {
  if (!box || !bb) return box;
  // Only follow a body that is clearly inside the box, and never by more than a fraction of the box per frame,
  // so one bad frame (or a neighbour at the edge) cannot drag the box away from the thrower.
  if (bb.cx < box.x || bb.cx > box.x + box.w || bb.cy < box.y || bb.cy > box.y + box.h) return box;
  const lim = (d, m) => Math.max(-0.2 * m, Math.min(0.2 * m, d));
  const cl = (v, m) => Math.min(Math.max(0, 1 - m), Math.max(0, v));
  const tx = bb.cx - box.w / 2, ty = bb.cy - box.h / 2;
  return { x: cl(box.x + lim((tx - box.x) * k, box.w), box.w), y: cl(box.y + lim((ty - box.y) * k, box.h), box.h), w: box.w, h: box.h };
}

// A tracker that stays open between frames so you can track one frame, a stretch, or step either way.
// Timestamps only ever go up (the tracker requires it), whichever direction the video is stepped.
export class TrackSession {
  constructor(lm, key) { this.lm = lm; this.key = key; this.ts = 0; this.crop = null; this.cropKey = ''; }
  static async create(model) { return new TrackSession(await createLandmarker({ model, mode: 'VIDEO', numPoses: 3 }), model); }
  close() { try { this.lm.close(); } catch (_) { /* ignore */ } }
  // Find the person in the pane's current video frame. box: Follow box or null. prev: where they were just before.
  detect(pane, box, prev, zoomCrop) {
    const media = pane.media, useCrop = !!(box && zoomCrop);
    let input = media.el;
    if (useCrop) {
      const key = box.w.toFixed(4) + 'x' + box.h.toFixed(4);
      if (!this.crop || this.cropKey !== key) { this.crop = cropCanvas(media, box); this.cropKey = key; }
      this.crop.ctx.drawImage(media.el, box.x * media.w, box.y * media.h, box.w * media.w, box.h * media.h, 0, 0, this.crop.c.width, this.crop.c.height);
      input = this.crop.c;
    }
    const map = useCrop ? (x, y) => [box.x + x * box.w, box.y + y * box.h] : (x, y) => [x, y];
    const res = this.lm.detectForVideo(input, (this.ts += 34));
    const people = (res.landmarks || []).map((l) => toFrame(l, map));
    // With a Follow box, a body whose center is outside it is a neighbour (or a guess made from a sliver): ignore it.
    const cand = box ? people.filter((fr) => { const b = bboxOf(fr); return b && b.cx >= box.x && b.cx <= box.x + box.w && b.cy >= box.y && b.cy <= box.y + box.h; }) : people;
    const pick = pickPerson(cand, prev, box);
    return { frame: pick ? pick.f : null, people: people.length };
  }
}

// Runs the tracker over every frame. Returns { frames, maxPeople }; frames has one entry per frame: Float32Array(99) or null.
export async function analyze(pane, { model = 'full', roi = null, zoomCrop = true, onProgress, signal }) {
  const media = pane.media;
  const useCrop = !!(roi && zoomCrop);
  const isImage = media.type === 'image';
  const lm = await createLandmarker({ model, mode: isImage ? 'IMAGE' : 'VIDEO', numPoses: roi ? 2 : 4 });
  const crop = useCrop ? cropCanvas(media, roi) : null;
  const map = useCrop
    ? (x, y) => [roi.x + x * roi.w, roi.y + y * roi.h]
    : (x, y) => [x, y];
  const frames = new Array(pane.N).fill(null);
  let prev = null, maxPeople = 0;
  try {
    for (let f = 0; f < pane.N; f++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (!isImage) { pane.f = f; await pane.seekTo(f); }
      let input = media.el;
      if (useCrop) {
        crop.ctx.drawImage(media.el, roi.x * media.w, roi.y * media.h, roi.w * media.w, roi.h * media.h, 0, 0, crop.c.width, crop.c.height);
        input = crop.c;
      }
      const res = isImage ? lm.detect(input) : lm.detectForVideo(input, Math.round((f * 1000) / pane.fps) + 1);
      const people = (res.landmarks || []).map((l) => toFrame(l, map));
      maxPeople = Math.max(maxPeople, people.length);
      const pick = pickPerson(people, prev, roi);
      if (pick) { frames[f] = pick.f; prev = pick.b; }
      onProgress?.(f + 1, pane.N, frames[f] !== null);
      if (f % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    try { lm.close(); } catch (_) { /* ignore */ }
  }
  return { frames, maxPeople };
}

// Light temporal smoothing weighted by joint visibility. level: 0 off, 1 light, 2 strong.
export function smoothFrames(raw, level) {
  if (!level) return raw;
  const r = level === 1 ? 1 : 2;
  const kernel = level === 1 ? [1, 2, 1] : [1, 2, 3, 2, 1];
  return raw.map((fr, i) => {
    if (!fr) return null;
    const out = new Float32Array(fr.length);
    for (let j = 0; j < 33; j++) {
      let sx = 0, sy = 0, sw = 0;
      for (let k = -r; k <= r; k++) {
        const o = raw[i + k];
        if (!o) continue;
        const v = o[j * 3 + 2];
        if (v < 0.1) continue;
        const w = kernel[k + r] * v;
        sx += o[j * 3] * w; sy += o[j * 3 + 1] * w; sw += w;
      }
      if (sw > 0) { out[j * 3] = sx / sw; out[j * 3 + 1] = sy / sw; } else { out[j * 3] = fr[j * 3]; out[j * 3 + 1] = fr[j * 3 + 1]; }
      out[j * 3 + 2] = fr[j * 3 + 2];
    }
    return out;
  });
}

export const packFrames = (frames) => frames.map((f) => (f ? Array.from(f, (v) => Math.round(v * 10000) / 10000) : null));
export const unpackFrames = (arr) => arr.map((f) => (f ? Float32Array.from(f) : null));

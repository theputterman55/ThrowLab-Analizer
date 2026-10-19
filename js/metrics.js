// Joint-angle measurements computed from MediaPipe pose landmarks.
// A frame is a Float32Array of 33 landmarks * [x, y, visibility], x/y normalized 0..1 on the video frame.

export const deg = (r) => (r * 180) / Math.PI;
const hyp = Math.hypot;

export function angle3(a, b, c) {
  const v1 = [a[0] - b[0], a[1] - b[1]];
  const v2 = [c[0] - b[0], c[1] - b[1]];
  const d = hyp(...v1) * hyp(...v2);
  if (!d) return NaN;
  return deg(Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / d))));
}

// Landmark indices (MediaPipe Pose, 33 points)
const ROLE = {
  R: { sh: 12, el: 14, wr: 16, hand: 20, hip: 24, kn: 26, an: 28, oSh: 11, oHip: 23, oKn: 25, oAn: 27 },
  L: { sh: 11, el: 13, wr: 15, hand: 19, hip: 23, kn: 25, an: 27, oSh: 12, oHip: 24, oKn: 26, oAn: 28 }
};
const FIXED = { nose: 0, lSh: 11, rSh: 12, lHip: 23, rHip: 24, lAn: 27, rAn: 28 };

export function roleIndex(role, hand) {
  return role in FIXED ? FIXED[role] : ROLE[hand][role];
}
export function throwingWristIndex(hand) { return ROLE[hand].wr; }

const MIN_VIS = 0.25;

// Angle of the line between two points, always read left-to-right on screen.
function tilt(a, b) {
  if (a[0] > b[0]) [a, b] = [b, a];
  return deg(Math.atan2(b[1] - a[1], b[0] - a[0]));
}

// Each metric: needs (landmark roles), fn(g, ctx) where g(role) returns [x,y] in pixels.
export const METRIC_DEFS = {
  elbow: {
    label: 'Elbow angle', needs: ['sh', 'el', 'wr'],
    fn: (g) => angle3(g('sh'), g('el'), g('wr')), fmt: (v) => v.toFixed(0) + '°'
  },
  arm: {
    label: 'Arm swing', needs: ['sh', 'el'],
    fn: (g, c) => { const s = g('sh'), e = g('el'); return deg(Math.atan2((e[0] - s[0]) * c.dir, e[1] - s[1])); },
    fmt: signedDeg
  },
  forearm: {
    label: 'Forearm swing', needs: ['el', 'wr'],
    fn: (g, c) => { const e = g('el'), w = g('wr'); return deg(Math.atan2((w[0] - e[0]) * c.dir, w[1] - e[1])); },
    fmt: signedDeg, note: 'Elbow to wrist, from straight down. + means toward the target'
  },
  wristBend: {
    label: 'Wrist angle', needs: ['el', 'wr', 'hand'],
    fn: (g) => angle3(g('el'), g('wr'), g('hand')), fmt: (v) => v.toFixed(0) + '°', note: '180° is a straight line from forearm to hand'
  },
  lean: {
    label: 'Torso lean', needs: ['lSh', 'rSh', 'lHip', 'rHip'],
    fn: (g, c) => {
      const a = g('lSh'), b = g('rSh'), h1 = g('lHip'), h2 = g('rHip');
      const sx = (a[0] + b[0]) / 2, sy = (a[1] + b[1]) / 2, hx = (h1[0] + h2[0]) / 2, hy = (h1[1] + h2[1]) / 2;
      return deg(Math.atan2((sx - hx) * c.dir, hy - sy));
    },
    fmt: signedDeg
  },
  knee: {
    label: 'Lead knee', needs: ['oHip', 'oKn', 'oAn'],
    fn: (g) => angle3(g('oHip'), g('oKn'), g('oAn')), fmt: (v) => v.toFixed(0) + '°'
  },
  wristH: {
    label: 'Wrist height', needs: ['wr', 'nose', 'lAn', 'rAn'],
    fn: (g) => {
      const w = g('wr'), n = g('nose'), a = g('lAn'), b = g('rAn');
      const ay = (a[1] + b[1]) / 2;
      return ((ay - w[1]) / (ay - n[1])) * 100;
    },
    fmt: (v) => v.toFixed(0) + '% of body'
  },
  shoulderTilt: {
    label: 'Shoulder tilt', needs: ['lSh', 'rSh'],
    fn: (g) => tilt(g('lSh'), g('rSh')),
    fmt: signedDeg, note: '+ means the shoulder on the right of the screen is lower'
  },
  hipTilt: {
    label: 'Hip tilt', needs: ['lHip', 'rHip'],
    fn: (g) => tilt(g('lHip'), g('rHip')),
    fmt: signedDeg, note: '+ means the hip on the right of the screen is lower'
  },
  stance: {
    label: 'Stance width', needs: ['lAn', 'rAn', 'lSh', 'rSh'],
    fn: (g) => {
      const a = g('lAn'), b = g('rAn'), s1 = g('lSh'), s2 = g('rSh');
      return (hyp(a[0] - b[0], a[1] - b[1]) / hyp(s1[0] - s2[0], s1[1] - s2[1])) * 100;
    },
    fmt: (v) => v.toFixed(0) + '% of shoulders'
  },
  armLine: {
    label: 'Arm line', needs: ['sh', 'wr'],
    fn: (g) => { const s = g('sh'), w = g('wr'); return deg(Math.atan2(w[0] - s[0], w[1] - s[1])); },
    fmt: signedDeg, note: 'Shoulder to wrist, from straight down, in the image'
  }
};

function signedDeg(v) { return (v > 0 ? '+' : '') + v.toFixed(0) + '°'; }

// Returns a number, or null when a needed joint is not visible.
export function computeMetric(key, frame, media, hand, dir) {
  const def = METRIC_DEFS[key];
  if (!def || !frame) return null;
  const g = (role) => {
    const i = roleIndex(role, hand) * 3;
    return [frame[i] * media.w, frame[i + 1] * media.h, frame[i + 2]];
  };
  for (const role of def.needs) if (!(g(role)[2] >= MIN_VIS)) return null;
  const v = def.fn((r) => g(r), { dir, hand });
  return Number.isFinite(v) ? v : null;
}

// Frame of fastest throwing-wrist motion: a starting guess for the release.
export function suggestRelease(frames, media, hand) {
  const wi = throwingWristIndex(hand) * 3;
  const pos = frames.map((f) => (f && f[wi + 2] >= 0.4 ? [f[wi] * media.w, f[wi + 1] * media.h] : null));
  let best = -1, bestV = 0;
  for (let i = 1; i < pos.length - 1; i++) {
    const a = pos[i - 1], b = pos[i + 1];
    if (!a || !b) continue;
    const v = hyp(b[0] - a[0], b[1] - a[1]);
    if (v > bestV) { bestV = v; best = i; }
  }
  return best;
}

// Drawing annotations. All points are stored normalized (0..1) on the video frame,
// so drawings stay put at any display size.

const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function tag(ctx, text, x, y, u) {
  ctx.save();
  ctx.font = `600 ${Math.round(20 * u)}px 'JetBrains Mono', ui-monospace, monospace`;
  const w = ctx.measureText(text).width + 14 * u;
  const h = 28 * u;
  ctx.fillStyle = 'rgba(0,0,0,.7)';
  rr(ctx, x - w / 2, y - h / 2, w, h, 6 * u);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}

export function lineAngle(p0, p1) {
  let d = deg(Math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]));
  if (d < 0) d += 180;
  if (d >= 180) d -= 180;
  return d;
}

export function angleBetween(a, v, b) {
  const a1 = Math.atan2(a[1] - v[1], a[0] - v[0]);
  const a2 = Math.atan2(b[1] - v[1], b[0] - v[0]);
  let df = a2 - a1;
  while (df > Math.PI) df -= 2 * Math.PI;
  while (df < -Math.PI) df += 2 * Math.PI;
  return { a1, a2, df, deg: Math.abs(deg(df)) };
}

// Lane axis of a board outline: through the midpoints of the near and far edges.
export function boardAxis(P, H) {
  const m1 = [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2];
  const m2 = [(P[3][0] + P[2][0]) / 2, (P[3][1] + P[2][1]) / 2];
  if (Math.abs(m2[1] - m1[1]) < 1e-6) return [m1, m2];
  const at = (y) => [m1[0] + ((m2[0] - m1[0]) * (y - m1[1])) / (m2[1] - m1[1]), y];
  return [at(H), at(0)];
}

// zoom: current view zoom. Strokes and labels are divided by it so they keep the same size on screen.
export function drawAnn(ctx, a, W, H, curFrame, zoom = 1) {
  const u = W / 1280 / zoom;
  const P = a.pts.map((q) => [q[0] * W, q[1] * H, q[2]]);
  if (!P.length) return;
  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = a.w * u;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const poly = (pts) => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke(); };
  const dot = (q, r) => { ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, Math.PI * 2); ctx.fill(); };
  const r0 = (a.w + 1) * u;

  if (a.type === 'line' && P.length > 1) {
    poly(P); P.forEach((q) => dot(q, r0));
    tag(ctx, lineAngle(P[0], P[1]).toFixed(1) + '°', (P[0][0] + P[1][0]) / 2 + 34 * u, (P[0][1] + P[1][1]) / 2, u);
  } else if (a.type === 'arrow' && P.length > 1) {
    poly(P);
    const an = Math.atan2(P[1][1] - P[0][1], P[1][0] - P[0][0]);
    const hl = (16 + a.w * 2.5) * u;
    ctx.beginPath();
    ctx.moveTo(P[1][0], P[1][1]);
    ctx.lineTo(P[1][0] - hl * Math.cos(an - 0.45), P[1][1] - hl * Math.sin(an - 0.45));
    ctx.lineTo(P[1][0] - hl * Math.cos(an + 0.45), P[1][1] - hl * Math.sin(an + 0.45));
    ctx.closePath(); ctx.fill();
  } else if (a.type === 'circle' && P.length > 1) {
    const r = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]);
    ctx.beginPath(); ctx.arc(P[0][0], P[0][1], r, 0, Math.PI * 2); ctx.stroke();
    dot(P[0], a.w * 0.6 * u);
  } else if (a.type === 'rect' && P.length > 1) {
    ctx.strokeRect(P[0][0], P[0][1], P[1][0] - P[0][0], P[1][1] - P[0][1]);
  } else if (a.type === 'angle') {
    poly(P); P.forEach((q) => dot(q, r0));
    if (P.length === 3) {
      const v = P[1], g = angleBetween(P[0], v, P[2]);
      ctx.beginPath(); ctx.arc(v[0], v[1], 38 * u, g.a1, g.a2, g.df < 0); ctx.stroke();
      const mid = g.a1 + g.df / 2;
      tag(ctx, g.deg.toFixed(1) + '°', v[0] + Math.cos(mid) * 78 * u, v[1] + Math.sin(mid) * 78 * u, u);
    }
  } else if (a.type === 'pen' && P.length > 1) {
    poly(P);
  } else if (a.type === 'path') {
    const shown = P.filter((q) => q[2] <= curFrame);
    if (shown.length > 1) poly(shown);
    shown.forEach((q, i) => dot(q, (i === shown.length - 1 ? a.w + 3 : a.w) * u));
  } else if (a.type === 'board' && P.length >= 2) {
    const pts = P.length === 4 ? [...P, P[0]] : P;
    poly(pts);
    P.forEach((q) => dot(q, r0));
    if (P.length === 4) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(1, (a.w - 2) * u);
      ctx.setLineDash([10 * u, 8 * u]);
      for (const t of [1 / 3, 2 / 3]) {
        const n = [P[0][0] + (P[1][0] - P[0][0]) * t, P[0][1] + (P[1][1] - P[0][1]) * t];
        const f = [P[3][0] + (P[2][0] - P[3][0]) * t, P[3][1] + (P[2][1] - P[3][1]) * t];
        poly([n, f]);
      }
      ctx.restore();
      ctx.save();
      ctx.lineWidth = Math.max(1, (a.w - 1) * u);
      ctx.setLineDash([18 * u, 12 * u]);
      const ax = boardAxis(P, H);
      poly(ax);
      ctx.restore();
    }
  }
  ctx.restore();
}

// Distance in canvas pixels from a point to an annotation (for the eraser).
function segD(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  let t = l ? ((x - a[0]) * dx + (y - a[1]) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}
export function annDist(a, x, y, W, H) {
  const P = a.pts.map((q) => [q[0] * W, q[1] * H]);
  let m = 1e9;
  if (a.type === 'circle') {
    return Math.abs(Math.hypot(x - P[0][0], y - P[0][1]) - Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]));
  }
  if (a.type === 'rect') {
    const [p0, p1] = P;
    const c = [[p0[0], p0[1]], [p1[0], p0[1]], [p1[0], p1[1]], [p0[0], p1[1]], [p0[0], p0[1]]];
    for (let i = 0; i < 4; i++) m = Math.min(m, segD(x, y, c[i], c[i + 1]));
    return m;
  }
  if (a.type === 'path') {
    for (const q of P) m = Math.min(m, Math.hypot(x - q[0], y - q[1]));
    return m;
  }
  const pts = a.type === 'board' && P.length === 4 ? [...P, P[0]] : P;
  for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, segD(x, y, pts[i], pts[i + 1]));
  return m;
}

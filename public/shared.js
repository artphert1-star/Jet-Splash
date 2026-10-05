// Geometry + card data shared by server (authority) and client (preview).
(function (g) {
  const a = 200, R = 170, HW = 55, PI = Math.PI;
  const L = 4 * a + 2 * PI * R; // one lap, measured along the centre line
  const CARDS = { S: { len: 90, turns: [0] }, G: { len: 75, turns: [-30, 30] }, T: { len: 55, turns: [-60, 60] } };
  const DECK = [...'S'.repeat(8), ...'G'.repeat(6), ...'T'.repeat(6)];
  // s = distance along track (0 at the gate, x=0 on the bottom straight), d = distance from centre line
  function locate(x, y) {
    let s, d;
    if (x > a) { const dx = x - a; d = Math.abs(Math.hypot(dx, y) - R); s = a + R * (PI / 2 - Math.atan2(y, dx)); }
    else if (x < -a) { const dx = x + a; let p = Math.atan2(y, dx); if (p < 0) p += 2 * PI; d = Math.abs(Math.hypot(dx, y) - R); s = 3 * a + PI * R + R * (1.5 * PI - p); }
    else if (y >= 0) { d = Math.abs(y - R); s = x; }
    else { d = Math.abs(-y - R); s = a + PI * R + (a - x); }
    return { s: ((s % L) + L) % L, d };
  }
  function unwrap(prev, s) { let d = s - (((prev % L) + L) % L); if (d > L / 2) d -= L; if (d < -L / 2) d += L; return prev + d; }
  function step(t, def, turn, f = 1) { const h = t.h + turn * PI / 180; return { x: t.x + Math.cos(h) * def.len * f, y: t.y + Math.sin(h) * def.len * f, h }; }
  function legal(t, def, turn) { const e = step(t, def, turn), m = step(t, def, turn, 0.5); return locate(e.x, e.y).d <= HW && locate(m.x, m.y).d <= HW; }
  const api = { a, R, HW, L, CARDS, DECK, locate, unwrap, step, legal };
  g.G = api; if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

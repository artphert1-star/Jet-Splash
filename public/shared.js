// Track geometry + card data shared by server (authority) and client (preview).
(function (g) {
  const PI = Math.PI, HW = 55;
  // sp = movement spaces a card uses. Courses are centre-line paths: ['l',len] straight, ['a',radius,degrees] arc (negative = left).
  const CARDS = { S: { len: 90, sp: 1, turns: [0] }, G: { len: 75, sp: 1, turns: [-30, 30] }, T: { len: 55, sp: 1, turns: [-60, 60] }, D: { len: 190, sp: 2, turns: [0] } };
  const DECK = [...'S'.repeat(6), ...'G'.repeat(5), ...'T'.repeat(5), ...'D'.repeat(4)];
  const COURSES = {
    circuit: { name: 'Tornado Circuit', start: [-60, 170, 0], lead: 60, tail: 60, segs: [['l', 60], ['l', 200], ['a', 170, -180], ['l', 400], ['a', 170, -180], ['l', 200], ['l', 60]] },
    splash: { name: 'Splashway', start: [-420, 180, 0], lead: 60, tail: 60, segs: [['l', 60], ['l', 280], ['a', 110, -90], ['l', 120], ['a', 110, 90], ['l', 220], ['l', 60]] },
    river: { name: 'Roundabout River', start: [-420, 160, 0], lead: 60, tail: 60, segs: [['l', 60], ['l', 500], ['a', 160, -180], ['l', 500], ['l', 60]] },
    rain: { name: 'Raindrop Road', start: [-420, 190, 0], lead: 60, tail: 60, segs: [['l', 60], ['l', 250], ['a', 90, -90], ['l', 150], ['a', 90, 90], ['l', 200], ['a', 90, 90], ['l', 100], ['l', 60]] }
  };
  const cache = {};
  function track(id) {
    if (cache[id]) return cache[id];
    const C = COURSES[id]; let [x, y, h] = C.start, s = 0; const pts = [{ x, y, h, s }];
    for (const sg of C.segs) {
      const len = sg[0] === 'l' ? sg[1] : Math.abs(sg[2]) * PI / 180 * sg[1], n = Math.max(1, Math.round(len / 4)), d = len / n, dh = sg[0] === 'l' ? 0 : sg[2] * PI / 180 / n;
      for (let i = 0; i < n; i++) { const hm = h + dh / 2; x += Math.cos(hm) * d; y += Math.sin(hm) * d; h += dh; s += d; pts.push({ x, y, h, s }); }
    }
    return cache[id] = { id, pts, lead: C.lead, Lf: s - C.tail, Lt: s, start: C.start };
  }
  // nearest centre-line sample, searched only near the previous progress so crossings/loops don't confuse it
  function locate(T, x, y, prev) {
    let best = 1e12, bp = null;
    for (const p of T.pts) { if (Math.abs(p.s - prev) > 250) continue; const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < best) { best = d; bp = p; } }
    return bp ? { s: bp.s, d: Math.sqrt(best), h: bp.h } : { s: prev, d: 1e9, h: 0 };
  }
  function step(t, def, turn, f = 1) { const h = t.h + turn * PI / 180; return { x: t.x + Math.cos(h) * def.len * f, y: t.y + Math.sin(h) * def.len * f, h }; }
  function legal(T, t, def, turn, obst = []) {
    const e = step(t, def, turn), m = step(t, def, turn, 0.5);
    if (locate(T, e.x, e.y, t.s).d > HW || locate(T, m.x, m.y, t.s).d > HW) return false;
    return !obst.some(o => Math.hypot(e.x - o.x, e.y - o.y) < 16 || Math.hypot(m.x - o.x, m.y - o.y) < 16);
  }
  function advance(T, t, def, turn) { const n = step(t, def, turn); n.s = locate(T, n.x, n.y, t.s).s; return n; }
  const api = { HW, CARDS, DECK, COURSES, track, locate, step, legal, advance };
  g.G = api; if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

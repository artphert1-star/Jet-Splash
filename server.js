const express = require('express'), http = require('http'), { Server } = require('socket.io');
const G = require('./public/shared.js');
const app = express(); app.use(express.static('public'));
const srv = http.createServer(app), io = new Server(srv), rooms = {};
const COLORS = ['#e4572e', '#17bebb', '#ffc914', '#7b4bb7', '#2e86ab', '#76b041'];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const draw = (p, n) => { while (p.hand.length < n) { const c = p.deck.pop() || p.played.shift(); if (!c) break; p.hand.push(c); } };
const canMove = p => p.hand.some(c => G.CARDS[c].turns.some(t => G.legal(p, G.CARDS[c], t)));

function view(r, id) {
  const me = r.players.find(p => p.id === id);
  return { code: r.code, host: r.host, phase: r.phase, round: r.round, turn: r.order[r.ti] || null, order: r.order, me: id, log: r.log.slice(-6), hand: me ? me.hand : [],
    players: r.players.map(p => ({ id: p.id, name: p.name, color: p.color, weight: p.weight, x: p.x, y: p.y, h: p.h, status: p.status, rank: p.rank, boostUsed: p.boostUsed, trail: p.trail })) };
}
const push = r => r.players.forEach(p => io.to(p.id).emit('state', view(r, p.id)));

function over(r) {
  r.phase = 'over';
  r.players.filter(p => p.status === 'racing').forEach(p => { p.status = 'finished'; p.rank = ++r.finished; });
  r.players.filter(p => p.status === 'out').forEach(p => p.rank = r.finished + 1);
  push(r);
}
function begin(r) {
  const rc = r.players.filter(p => p.status === 'racing');
  if (rc.length <= 1) return over(r);
  rc.sort((a, b) => b.s - a.s || a.weight - b.weight);       // ranking phase (ties: lighter boat first)
  r.order = rc.map(p => p.id); r.round++; r.ti = 0; r.phase = 'action';
  rc.forEach((p, i) => draw(p, i === 0 ? 4 : i === rc.length - 1 ? 6 : 5)); // draw phase
  turn(r);
}
function turn(r) {
  while (r.ti < r.order.length) {
    const p = r.players.find(x => x.id === r.order[r.ti]);
    if (p && p.status === 'racing') { if (canMove(p)) break; p.status = 'out'; r.log.push(p.name + ' ออกนอกสนาม!'); }
    r.ti++;
  }
  if (r.ti >= r.order.length) begin(r); else push(r);
}

io.on('connection', s => {
  let r = null; const me = () => r && r.players.find(p => p.id === s.id);
  s.on('join', ({ name, code }) => {
    name = String(name || 'Racer').slice(0, 12);
    if (code) {
      r = rooms[String(code).trim().toUpperCase()];
      if (!r) return s.emit('err', 'ไม่พบห้อง');
      if (r.phase !== 'lobby' || r.players.length >= 5) return s.emit('err', 'เข้าห้องไม่ได้ (เต็มหรือเริ่มแล้ว)');
    } else {
      const c = Math.random().toString(36).slice(2, 6).toUpperCase();
      r = rooms[c] = { code: c, host: s.id, phase: 'lobby', players: [], order: [], ti: 0, round: 0, finished: 0, log: [] };
    }
    r.players.push({ id: s.id, name, color: COLORS[r.players.length], weight: 0, status: 'racing', hand: [], deck: [], played: [], boostUsed: false, rank: 0, trail: [], x: 0, y: 0, h: 0, s: 0 });
    push(r);
  });
  s.on('start', () => {
    if (!r || r.host !== s.id || r.players.length < 2 || !['lobby', 'over'].includes(r.phase)) return;
    const n = r.players.length, ws = shuffle([1, 2, 3, 4, 5, 6]);
    r.players.forEach((p, i) => p.weight = ws[i]);
    [...r.players].sort((a, b) => b.weight - a.weight).forEach((p, j) => {   // heaviest boat picks the inner lane
      Object.assign(p, { x: -30, y: G.R - 10 * (n - 1) + 20 * j, h: 0, s: -30, status: 'racing', rank: 0, boostUsed: false, hand: [], played: [], deck: shuffle([...G.DECK]) });
      p.trail = [[p.x, p.y]];
    });
    r.finished = 0; r.round = 0; r.log = ['เริ่มแข่ง!']; begin(r);
  });
  s.on('commit', ({ plays, boost }) => {
    const p = me(); if (!r || !p || r.phase !== 'action' || r.order[r.ti] !== p.id || !Array.isArray(plays)) return;
    const bad = m => s.emit('err', m), max = boost && !p.boostUsed ? 4 : 3;
    if (plays.length > max) return bad('เดินได้ไม่เกิน ' + max + ' ช่อง');
    let t = { x: p.x, y: p.y, h: p.h, s: p.s }, used = [], trail = [], fin = false;
    for (const { i, t: tn } of plays) {
      const c = p.hand[i]; if (!c || used.includes(i)) return bad('การ์ดไม่ถูกต้อง');
      const d = G.CARDS[c]; if (!d.turns.includes(tn)) return bad('เลี้ยวแบบนี้ไม่ได้');
      if (!G.legal(t, d, tn)) return bad('ออกนอกสนาม');
      const n = G.step(t, d, tn); n.s = G.unwrap(t.s, G.locate(n.x, n.y).s); t = n; used.push(i); trail.push([n.x, n.y]);
      if (t.s >= G.L) { fin = true; break; }
    }
    p.played.push(...used.map(i => p.hand[i]));
    [...used].sort((a, b) => b - a).forEach(i => p.hand.splice(i, 1));
    if (boost && !p.boostUsed) { p.boostUsed = true; r.log.push(p.name + ' ใช้บูสต์!'); }
    Object.assign(p, { x: t.x, y: t.y, h: t.h, s: t.s }); p.trail = p.trail.concat(trail).slice(-40);
    if (fin) { p.status = 'finished'; p.rank = ++r.finished; r.log.push(p.name + ' เข้าเส้นชัยอันดับ ' + p.rank); }
    r.ti++; turn(r);
  });
  s.on('disconnect', () => {
    const p = me(); if (!r || !p) return;
    if (r.phase === 'lobby') { r.players = r.players.filter(x => x !== p); if (!r.players.length) delete rooms[r.code]; else { if (r.host === s.id) r.host = r.players[0].id; push(r); } return; }
    if (p.status === 'racing') { p.status = 'out'; r.log.push(p.name + ' หลุดจากเกม'); if (r.phase === 'action' && r.order[r.ti] === p.id) { r.ti++; turn(r); } else push(r); }
  });
});
srv.listen(process.env.PORT || 3000, () => console.log('up'));

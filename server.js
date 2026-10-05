const express = require('express'), http = require('http'), { Server } = require('socket.io');
const G = require('./public/shared.js');
const app = express(); app.use(express.static('public'));
const srv = http.createServer(app), io = new Server(srv), rooms = {}, BOT_MS = +process.env.BOT_MS || 900;
const COLORS = ['#e4572e', '#17bebb', '#ffc914', '#7b4bb7', '#2e86ab', '#76b041'];
let botN = 0;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const draw = (p, n) => { while (p.hand.length < n) { const c = p.deck.pop() || p.played.shift(); if (!c) break; p.hand.push(c); } };
const obstOf = (r, p) => r.players.filter(q => q !== p && q.status === 'racing');
const canMove = (r, p) => { const o = obstOf(r, p); return p.hand.some(c => G.CARDS[c].turns.some(t => G.legal(r.T, p, G.CARDS[c], t, o))); };

function view(r, pid) {
  const me = r.players.find(p => p.id === pid);
  return { code: r.code, host: r.host, phase: r.phase, round: r.round, turn: r.order[r.ti] || null, order: r.order, me: pid, log: r.log.slice(-6), course: r.course, gp: r.gp, hand: me ? me.hand : [],
    players: r.players.map(p => ({ id: p.id, name: p.name, bot: p.bot, off: p.off, color: p.color, weight: p.weight, x: p.x, y: p.y, h: p.h, status: p.status, rank: p.rank, boostUsed: p.boostUsed, trail: p.trail })) };
}
const push = r => r.players.forEach(p => p.sid && io.to(p.sid).emit('state', view(r, p.id)));

function over(r) {
  r.phase = 'over';
  r.players.filter(p => p.status === 'racing').forEach(p => { p.status = 'finished'; p.rank = ++r.finished; });
  r.players.filter(p => p.status === 'out').forEach(p => p.rank = r.finished + 1);
  if (r.gp.on) r.players.forEach(p => { const pt = p.status === 'out' || p.rank === r.players.length ? 0 : [5, 3, 2, 0, 0][p.rank - 1] || 0; r.gp.pts[p.id] = (r.gp.pts[p.id] || 0) + pt; });
  push(r);
}
function begin(r) {
  const rc = r.players.filter(p => p.status === 'racing');
  if (rc.length <= 1) return over(r);
  rc.sort((a, b) => b.s - a.s || a.weight - b.weight);          // ranking phase
  r.order = rc.map(p => p.id); r.round++; r.ti = 0; r.phase = 'action';
  rc.forEach((p, i) => draw(p, i === 0 ? 4 : i === rc.length - 1 ? 6 : 5)); // draw phase
  turn(r);
}
function turn(r) {
  while (r.ti < r.order.length) {
    const p = r.players.find(x => x.id === r.order[r.ti]);
    if (p && p.status === 'racing') { if (canMove(r, p)) break; p.status = 'out'; r.log.push(p.name + ' ออกนอกสนาม!'); }
    r.ti++;
  }
  if (r.ti >= r.order.length) return begin(r);
  push(r); const p = r.players.find(x => x.id === r.order[r.ti]); if (p.bot || p.off) schedule(r, p);
}
function schedule(r, p) { const tk = ++r.tk; setTimeout(() => { if (!r.dead && r.tk === tk && r.phase === 'action' && r.order[r.ti] === p.id && (p.bot || p.off)) auto(r, p); }, p.bot ? BOT_MS : 12000); }
function auto(r, p) { const { plays, boost } = plan(r, p); if (commit(r, p, plays, boost)) commit(r, p, [], false); }

function commit(r, p, plays, boost) {
  if (r.phase !== 'action' || r.order[r.ti] !== p.id || !Array.isArray(plays)) return 'ยังไม่ถึงตาคุณ';
  const T = r.T, max = boost && !p.boostUsed ? 4 : 3, obst = obstOf(r, p);
  let t = { x: p.x, y: p.y, h: p.h, s: p.s }, used = [], trail = [], sp = 0, fin = false;
  for (const { i, t: tn } of plays) {
    const c = p.hand[i]; if (!c || used.includes(i)) return 'การ์ดไม่ถูกต้อง';
    const d = G.CARDS[c]; if (!d.turns.includes(tn)) return 'เลี้ยวแบบนี้ไม่ได้';
    if ((sp += d.sp) > max) return 'เดินได้ไม่เกิน ' + max + ' ช่อง';
    if (!G.legal(T, t, d, tn, obst)) return 'ออกนอกสนามหรือชนคนอื่น';
    t = G.advance(T, t, d, tn); used.push(i); trail.push([t.x, t.y]);
    if (t.s >= T.Lf) { fin = true; break; }
  }
  p.played.push(...used.map(i => p.hand[i]));
  [...used].sort((a, b) => b - a).forEach(i => p.hand.splice(i, 1));
  if (boost && !p.boostUsed) { p.boostUsed = true; r.log.push(p.name + ' ใช้บูสต์!'); }
  Object.assign(p, { x: t.x, y: t.y, h: t.h, s: t.s }); p.trail = p.trail.concat(trail).slice(-40);
  if (fin) { p.status = 'finished'; p.rank = ++r.finished; r.log.push(p.name + ' เข้าเส้นชัยอันดับ ' + p.rank); }
  r.ti++; turn(r); return null;
}

// Bot: search every card sequence this turn, keep the best-scoring end state.
function plan(r, p) {
  const T = r.T, obst = obstOf(r, p), wrap = a => Math.abs(((a % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  const evalS = t => {
    const l = G.locate(T, t.x, t.y, t.s); let sc = t.s - 1.2 * Math.max(0, l.d - 25) - 40 * wrap(t.h - l.h);
    return sc;
  };
  let best = { sc: -1e9, plays: [], sp: 0 }; const used = [], plays = [], max = p.boostUsed ? 3 : 4;
  (function dfs(t, sp) {
    const sc = evalS(t); if (plays.length && sc > best.sc) best = { sc, plays: [...plays], sp };
    p.hand.forEach((c, i) => {
      if (used[i]) return; const d = G.CARDS[c];
      d.turns.forEach(tn => {
        if (sp + d.sp > max || !G.legal(T, t, d, tn, obst)) return;
        const n = G.advance(T, t, d, tn); used[i] = true; plays.push({ i, t: tn });
        if (n.s >= T.Lf) { if (1e6 - sp > best.sc) best = { sc: 1e6 - sp, plays: [...plays], sp: sp + d.sp }; } else dfs(n, sp + d.sp);
        plays.pop(); used[i] = false;
      });
    });
  })({ x: p.x, y: p.y, h: p.h, s: p.s }, 0);
  return { plays: best.plays, boost: best.sp > 3 };
}

io.on('connection', s => {
  let r = null; const me = () => r && r.players.find(p => p.sid === s.id);
  s.on('join', ({ name, code, pid }) => {
    pid = String(pid || Math.random().toString(36).slice(2)); name = String(name || 'Racer').slice(0, 12);
    if (code) {
      r = rooms[String(code).trim().toUpperCase()]; if (!r) return s.emit('err', 'ไม่พบห้อง');
      const old = r.players.find(p => p.id === pid);
      if (old) { old.sid = s.id; old.off = false; return push(r); }                  // reconnect after refresh
      if (r.phase !== 'lobby' || r.players.length >= 5) return s.emit('err', 'เข้าห้องไม่ได้ (เต็มหรือเริ่มแล้ว)');
    } else {
      const c = Math.random().toString(36).slice(2, 6).toUpperCase();
      r = rooms[c] = { code: c, host: pid, phase: 'lobby', players: [], order: [], ti: 0, round: 0, finished: 0, log: [], tk: 0, course: 'circuit', gp: { on: false, race: 0, pts: {} } };
    }
    r.players.push({ id: pid, sid: s.id, name, color: COLORS[r.players.length], weight: 0, status: 'racing', hand: [], deck: [], played: [], boostUsed: false, rank: 0, trail: [], x: 0, y: 0, h: 0, s: 0 });
    push(r);
  });
  s.on('addBot', () => {
    const h = me(); if (!r || !h || r.host !== h.id || r.phase !== 'lobby' || r.players.length >= 5) return;
    const n = ++botN; r.players.push({ id: 'bot' + n, bot: true, name: 'Bot ' + n, color: COLORS[r.players.length], weight: 0, status: 'racing', hand: [], deck: [], played: [], boostUsed: false, rank: 0, trail: [], x: 0, y: 0, h: 0, s: 0 });
    push(r);
  });
  s.on('start', ({ course, gp } = {}) => {
    const h = me(); if (!r || !h || r.host !== h.id || r.players.length < 2 || !['lobby', 'over'].includes(r.phase)) return;
    if (r.phase === 'over' && r.gp.on && r.gp.race < 3) r.gp.race++;                    // next Grand Prix race, same course
    else { r.course = G.COURSES[course] ? course : 'circuit'; r.gp = { on: !!gp, race: 1, pts: {} }; }
    r.T = G.track(r.course);
    const n = r.players.length, ws = shuffle([1, 2, 3, 4, 5, 6]);
    r.players.forEach((p, i) => p.weight = ws[i]);
    [...r.players].sort((a, b) => b.weight - a.weight).forEach((p, j) => {              // heaviest boat takes the inner lane
      Object.assign(p, { x: r.T.start[0] + 30, y: r.T.start[1] - 10 * (n - 1) + 20 * j, h: r.T.start[2], s: 30, status: 'racing', rank: 0, boostUsed: false, hand: [], played: [], deck: shuffle([...G.DECK]) });
      p.trail = [[p.x, p.y]];
    });
    r.finished = 0; r.round = 0; r.log = ['เริ่มแข่ง!']; begin(r);
  });
  s.on('commit', ({ plays, boost }) => { const p = me(); if (!r || !p) return; const e = commit(r, p, plays, boost); if (e) s.emit('err', e); });
  s.on('disconnect', () => {
    const p = me(); if (!r || !p) return;
    if (r.phase === 'lobby') { r.players = r.players.filter(x => x !== p); if (!r.players.some(x => !x.bot)) delete rooms[r.code]; else { if (r.host === p.id) r.host = r.players.find(x => !x.bot).id; push(r); } return; }
    p.off = true; r.log.push(p.name + ' หลุด (บอทเล่นแทนชั่วคราว)');
    if (r.players.every(x => x.bot || x.off)) { r.dead = true; delete rooms[r.code]; return; }
    if (r.phase === 'action' && r.order[r.ti] === p.id) schedule(r, p); push(r);
  });
});
srv.listen(process.env.PORT || 3000, () => console.log('up'));

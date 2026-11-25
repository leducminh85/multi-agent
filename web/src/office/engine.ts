import { COLS, CORRIDOR_Y, ROOMS, ROWS, TILE, assignSeats, deskSeats, meetingSeats, roomById, route, type Seat } from './layout';

/**
 * Canvas 2D pixel-art renderer for the Virtual Office.
 * Every visual state is driven by real agent data (activity, current task, messages, running tasks).
 * The engine is framework-agnostic: React only feeds it data and receives click events.
 */
export interface OfficeAgent {
  id: string;
  name: string;
  color: string;
  hair: number;
  activity: string;
  detail: string | null;
  paused: boolean;
  enabled: boolean;
  department: string;
}

interface Sprite {
  agent: OfficeAgent;
  x: number;
  y: number;
  path: { x: number; y: number }[];
  seat: Seat;
  dir: 'up' | 'down' | 'left' | 'right';
  walk: number;
  moving: boolean;
  goal: 'desk' | 'meeting' | 'coffee';
  nextStroll: number;
  strollUntil: number;
  fx: { kind: 'done' | 'error'; t0: number }[];
}

interface Link {
  a: string;
  b: string;
  until: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

const W = COLS * TILE;
const H = ROWS * TILE;
const SKIN = ['#f5d0b5', '#e8b48f', '#c98f6b', '#a86f4c', '#f0c8a0'];
const HAIR = ['#2b1d14', '#6b3e1f', '#d6a756', '#1f2433', '#8b2f3a', '#9aa1ad'];
const WORK = new Set(['working', 'thinking', 'reading', 'writing', 'coding', 'waiting', 'error', 'completed']);
const COFFEE = { x: 25.5 * TILE, y: 3.2 * TILE };

export class OfficeEngine {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private sprites = new Map<string, Sprite>();
  private links: Link[] = [];
  private particles: Particle[] = [];
  private raf = 0;
  private scale = 1;
  private offX = 0;
  private offY = 0;
  private hover: string | null = null;
  private selected: string | null = null;
  private runningTasks = 0;
  private meeting = meetingSeats();
  private ro: ResizeObserver;
  private last = performance.now();

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: { onSelect: (id: string | null) => void; fill?: boolean },
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.bg = document.createElement('canvas');
    this.bg.width = W;
    this.bg.height = H;
    this.drawBackground(this.bg.getContext('2d')!);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
    canvas.addEventListener('mousemove', this.onMove);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('mouseleave', () => (this.hover = null));
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener('mousemove', this.onMove);
    this.canvas.removeEventListener('click', this.onClick);
  }

  // ------------------------------------------------------------------ data in
  setAgents(agents: OfficeAgent[]) {
    const seats = assignSeats(agents.map((a) => ({ id: a.id, department: a.department })));
    const now = performance.now() / 1000;
    for (const id of [...this.sprites.keys()]) if (!agents.find((a) => a.id === id)) this.sprites.delete(id);
    for (const a of agents) {
      const seat = seats.get(a.id)!;
      const s = this.sprites.get(a.id);
      if (!s) {
        this.sprites.set(a.id, { agent: a, x: seat.x, y: seat.y, path: [], seat, dir: 'up', walk: 0, moving: false, goal: 'desk', nextStroll: now + 20 + Math.random() * 40, strollUntil: 0, fx: [] });
        continue;
      }
      const prev = s.agent.activity;
      s.agent = a;
      if (s.seat.x !== seat.x || s.seat.y !== seat.y) {
        s.seat = seat;
        if (s.goal === 'desk') s.path = route(s, seat);
      }
      if (prev !== a.activity) {
        if (a.activity === 'completed') this.celebrate(a.id);
        if (a.activity === 'error') s.fx.push({ kind: 'error', t0: now });
      }
    }
    this.updateGoals();
  }

  setRunningTasks(n: number) {
    this.runningTasks = n;
  }

  setSelected(id: string | null) {
    this.selected = id;
  }

  /** Show that two agents are collaborating (from real agent-to-agent messages). */
  pulseLink(a: string, b: string) {
    if (!this.sprites.has(a) || !this.sprites.has(b)) return;
    this.links = this.links.filter((l) => !(l.a === a && l.b === b));
    this.links.push({ a, b, until: performance.now() / 1000 + 10 });
  }

  celebrate(id: string) {
    const s = this.sprites.get(id);
    if (!s) return;
    s.fx.push({ kind: 'done', t0: performance.now() / 1000 });
    for (let i = 0; i < 18; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 20 + Math.random() * 40;
      this.particles.push({ x: s.x, y: s.y - 18, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 30, life: 1, color: ['#fde047', '#34d399', '#818cf8', '#f472b6'][i % 4] });
    }
  }

  // ------------------------------------------------------------------ behaviour
  private updateGoals() {
    const discussing = [...this.sprites.values()].filter((s) => s.agent.activity === 'discussing');
    const used = new Set<number>();
    for (const s of this.sprites.values()) {
      let target: { x: number; y: number } = s.seat;
      let goal: Sprite['goal'] = 'desk';
      if (s.agent.activity === 'discussing') {
        const idx = discussing.indexOf(s) % this.meeting.length;
        used.add(idx);
        target = this.meeting[idx];
        goal = 'meeting';
      } else if (s.goal === 'coffee' && s.agent.activity === 'idle' && performance.now() / 1000 < s.strollUntil) {
        continue;
      }
      if (goal !== s.goal || (goal === 'desk' && !s.moving && (Math.abs(s.x - target.x) > 1 || Math.abs(s.y - target.y) > 1) && s.path.length === 0)) {
        s.goal = goal;
        s.path = route(s, target);
      }
    }
  }

  private step(dt: number, t: number) {
    for (const s of this.sprites.values()) {
      // idle agents occasionally stroll to the coffee machine (ambient life, not progress)
      if (s.agent.activity === 'idle' && !s.agent.paused && s.goal === 'desk' && !s.path.length && t > s.nextStroll) {
        s.goal = 'coffee';
        s.strollUntil = t + 8;
        s.path = route(s, { x: COFFEE.x + (Math.random() * 30 - 15), y: COFFEE.y + 14 });
        s.nextStroll = t + 45 + Math.random() * 60;
      }
      if (s.goal === 'coffee' && t > s.strollUntil && !s.path.length) {
        s.goal = 'desk';
        s.path = route(s, s.seat);
      }
      if (s.goal === 'coffee' && s.agent.activity !== 'idle') {
        s.goal = 'desk';
        s.path = route(s, s.seat);
      }
      const tgt = s.path[0];
      if (!tgt) {
        s.moving = false;
        continue;
      }
      const dx = tgt.x - s.x;
      const dy = tgt.y - s.y;
      const dist = Math.hypot(dx, dy);
      const speed = 70;
      if (dist < 1.5) {
        s.x = tgt.x;
        s.y = tgt.y;
        s.path.shift();
        continue;
      }
      s.moving = true;
      s.x += (dx / dist) * Math.min(dist, speed * dt);
      s.y += (dy / dist) * Math.min(dist, speed * dt);
      s.walk += dt * 10;
      s.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    }
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 60 * dt;
      p.life -= dt * 0.9;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.links = this.links.filter((l) => l.until > t);
  }

  // ------------------------------------------------------------------ input
  private toLogical(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: ((e.clientX - r.left) * dpr - this.offX) / this.scale, y: ((e.clientY - r.top) * dpr - this.offY) / this.scale };
  }

  private hit(p: { x: number; y: number }): string | null {
    let best: string | null = null;
    let bestY = -Infinity;
    for (const s of this.sprites.values()) {
      if (p.x >= s.x - 8 && p.x <= s.x + 8 && p.y >= s.y - 24 && p.y <= s.y + 4 && s.y > bestY) {
        best = s.agent.id;
        bestY = s.y;
      }
    }
    return best;
  }

  private onMove = (e: MouseEvent) => {
    this.hover = this.hit(this.toLogical(e));
    this.canvas.style.cursor = this.hover ? 'pointer' : 'default';
  };

  private onClick = (e: MouseEvent) => {
    this.opts.onSelect(this.hit(this.toLogical(e)));
  };

  private resize() {
    const parent = this.canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const cw = parent.clientWidth;
    const ch = this.opts.fill ? Math.max(200, parent.clientHeight) : Math.max(320, Math.min(parent.clientWidth * (H / W), window.innerHeight - 180));
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    this.canvas.width = Math.floor(cw * dpr);
    this.canvas.height = Math.floor(ch * dpr);
    this.scale = Math.min(this.canvas.width / W, this.canvas.height / H);
    this.offX = (this.canvas.width - W * this.scale) / 2;
    this.offY = (this.canvas.height - H * this.scale) / 2;
  }

  // ------------------------------------------------------------------ render loop
  private frame = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = now / 1000;
    this.updateGoals();
    this.step(dt, t);
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#080a12';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.scale, 0, 0, this.scale, this.offX, this.offY);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.bg, 0, 0);
    this.drawServers(c, t);
    this.drawMonitors(c, t);
    this.drawLinks(c, t);
    const sorted = [...this.sprites.values()].sort((a, b) => a.y - b.y);
    for (const s of sorted) this.drawAgent(c, s, t);
    for (const s of sorted) this.drawOverlay(c, s, t);
    for (const p of this.particles) {
      c.globalAlpha = Math.max(0, p.life);
      c.fillStyle = p.color;
      c.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
    c.globalAlpha = 1;
    this.raf = requestAnimationFrame(this.frame);
  };

  // ------------------------------------------------------------------ static background
  private drawBackground(c: CanvasRenderingContext2D) {
    c.fillStyle = '#0f1322';
    c.fillRect(0, 0, W, H);
    // corridor
    for (let x = 0; x < COLS; x++)
      for (let y = CORRIDOR_Y - 1; y <= CORRIDOR_Y + 1; y++) {
        c.fillStyle = (x + y) % 2 ? '#1a1f33' : '#1c2238';
        c.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    c.fillStyle = '#2a3150';
    for (let x = 1; x < COLS; x += 4) c.fillRect(x * TILE, CORRIDOR_Y * TILE + 7, TILE, 2);

    for (const r of ROOMS) {
      for (let x = r.x; x < r.x + r.w; x++)
        for (let y = r.y; y < r.y + r.h; y++) {
          c.fillStyle = r.floor[(x + y) % 2];
          c.fillRect(x * TILE, y * TILE, TILE, TILE);
        }
      // walls
      c.fillStyle = r.wall;
      c.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, 6);
      c.fillRect(r.x * TILE, r.y * TILE, 3, r.h * TILE);
      c.fillRect((r.x + r.w) * TILE - 3, r.y * TILE, 3, r.h * TILE);
      const bottom = r.y < CORRIDOR_Y;
      const doorX = (r.x + r.w / 2 - 1) * TILE;
      const wy = bottom ? (r.y + r.h) * TILE - 3 : r.y * TILE;
      c.fillRect(r.x * TILE, wy, doorX - r.x * TILE, 3);
      c.fillRect(doorX + 2 * TILE, wy, (r.x + r.w) * TILE - doorX - 2 * TILE, 3);
      if (!bottom) c.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, 6);
      // label
      c.fillStyle = 'rgba(0,0,0,.35)';
      c.fillRect(r.x * TILE + 6, r.y * TILE + 8, r.name.length * 5 + 8, 11);
      c.fillStyle = '#cbd5e1';
      c.font = '8px monospace';
      c.textBaseline = 'top';
      c.fillText(r.name, r.x * TILE + 10, r.y * TILE + 10);
    }

    // desks
    for (const r of ROOMS) {
      for (const s of seatsFor(r.id)) {
        const d = s.desk;
        c.fillStyle = '#6b4a2b';
        c.fillRect(d.x * TILE - 4, d.y * TILE + 4, d.w * TILE + 8, TILE + 2);
        c.fillStyle = '#7c5733';
        c.fillRect(d.x * TILE - 4, d.y * TILE + 4, d.w * TILE + 8, 4);
        c.fillStyle = '#3f2a18';
        c.fillRect(d.x * TILE - 4, d.y * TILE + TILE + 4, d.w * TILE + 8, 2);
        // monitor frame (screen drawn dynamically)
        c.fillStyle = '#111827';
        c.fillRect(d.x * TILE + 6, d.y * TILE - 6, 20, 14);
        c.fillStyle = '#374151';
        c.fillRect(d.x * TILE + 14, d.y * TILE + 8, 4, 3);
        // keyboard + mug
        c.fillStyle = '#1f2937';
        c.fillRect(d.x * TILE + 8, d.y * TILE + 12, 16, 3);
        c.fillStyle = '#e5e7eb';
        c.fillRect(d.x * TILE + 28, d.y * TILE + 9, 3, 4);
        // chair
        c.fillStyle = '#1e293b';
        c.fillRect(s.x - 6, s.y - 9, 12, 8);
        c.fillStyle = '#334155';
        c.fillRect(s.x - 6, s.y - 2, 12, 3);
      }
    }

    // meeting table + whiteboard
    const m = roomById('meeting');
    c.fillStyle = '#5b3d22';
    c.fillRect((m.x + 2) * TILE, (m.y + 4.5) * TILE, (m.w - 4) * TILE, 3.2 * TILE);
    c.fillStyle = '#6e4b2b';
    c.fillRect((m.x + 2) * TILE, (m.y + 4.5) * TILE, (m.w - 4) * TILE, 6);
    c.fillStyle = '#e2e8f0';
    c.fillRect((m.x + 3) * TILE, m.y * TILE + 8, (m.w - 6) * TILE, 18);
    c.fillStyle = '#60a5fa';
    c.fillRect((m.x + 3.5) * TILE, m.y * TILE + 13, 30, 2);
    c.fillStyle = '#f472b6';
    c.fillRect((m.x + 3.5) * TILE, m.y * TILE + 18, 50, 2);

    // manager office: big desk + "YOU"
    const mg = roomById('manager');
    c.fillStyle = '#4a2f1d';
    c.fillStyle = '#7f1d1d';
    c.fillRect((mg.x + 1.5) * TILE, (mg.y + 6) * TILE, 7 * TILE, 5 * TILE); // rug
    c.fillStyle = '#4a2f1d';
    c.fillRect((mg.x + 2) * TILE, (mg.y + 7) * TILE, 6 * TILE, 2 * TILE);
    c.fillStyle = '#5b3a24';
    c.fillRect((mg.x + 2) * TILE, (mg.y + 7) * TILE, 6 * TILE, 5);
    c.fillStyle = '#111827';
    c.fillRect((mg.x + 4.2) * TILE, (mg.y + 6.2) * TILE, 26, 14);
    c.fillStyle = '#1e3a8a';
    c.fillRect((mg.x + 4.2) * TILE + 2, (mg.y + 6.2) * TILE + 2, 22, 10);
    c.fillStyle = '#fbbf24';
    c.font = '8px monospace';
    c.fillText('MANAGER (YOU)', (mg.x + 2.6) * TILE, (mg.y + 9.4) * TILE);

    // coffee machine & water cooler (main office)
    c.fillStyle = '#1f2937';
    c.fillRect(COFFEE.x - 8, COFFEE.y - 14, 16, 18);
    c.fillStyle = '#ef4444';
    c.fillRect(COFFEE.x - 2, COFFEE.y - 10, 4, 3);
    c.fillStyle = '#93c5fd';
    c.fillRect(COFFEE.x + 14, COFFEE.y - 14, 8, 16);

    // plants & shelves
    const plant = (x: number, y: number) => {
      c.fillStyle = '#7c2d12';
      c.fillRect(x - 4, y, 8, 6);
      c.fillStyle = '#22c55e';
      c.fillRect(x - 6, y - 8, 12, 9);
      c.fillStyle = '#16a34a';
      c.fillRect(x - 3, y - 12, 6, 5);
    };
    for (const r of ROOMS) if (r.id !== 'server') plant((r.x + r.w - 1.2) * TILE, (r.y + 1.4) * TILE);
    const shelf = (x: number, y: number, w: number) => {
      c.fillStyle = '#5b3a24';
      c.fillRect(x, y, w, 14);
      const colors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7'];
      for (let i = 0; i < w / 4 - 1; i++) {
        c.fillStyle = colors[i % colors.length];
        c.fillRect(x + 2 + i * 4, y + 2, 3, 10);
      }
    };
    shelf(roomById('research').x * TILE + 40, roomById('research').y * TILE + 8, 60);
    shelf(roomById('content').x * TILE + 40, roomById('content').y * TILE + 8, 48);
    // design easel
    const ds = roomById('design');
    c.fillStyle = '#a16207';
    c.fillRect((ds.x + ds.w - 2.5) * TILE, (ds.y + ds.h - 4) * TILE, 3, 30);
    c.fillStyle = '#f8fafc';
    c.fillRect((ds.x + ds.w - 3.2) * TILE, (ds.y + ds.h - 4.6) * TILE, 26, 20);
    c.fillStyle = '#f472b6';
    c.fillRect((ds.x + ds.w - 3) * TILE, (ds.y + ds.h - 4.3) * TILE, 10, 8);
    c.fillStyle = '#38bdf8';
    c.fillRect((ds.x + ds.w - 2.4) * TILE, (ds.y + ds.h - 3.9) * TILE, 8, 8);
  }

  // ------------------------------------------------------------------ dynamic scenery
  private drawServers(c: CanvasRenderingContext2D, t: number) {
    const r = roomById('server');
    // LED activity reflects the real number of running tasks
    const load = Math.min(1, this.runningTasks / 4);
    for (let i = 0; i < 3; i++) {
      const x = (r.x + 1 + i * 2.2) * TILE;
      const y = (r.y + 2) * TILE;
      c.fillStyle = '#0b1220';
      c.fillRect(x, y, 24, 8 * TILE);
      c.fillStyle = '#1e293b';
      for (let u = 0; u < 10; u++) c.fillRect(x + 2, y + 4 + u * 12, 20, 9);
      for (let u = 0; u < 10; u++) {
        const on = Math.sin(t * (2 + load * 18) + u * 1.7 + i * 3.1) > 0.6 - load;
        c.fillStyle = on ? (load > 0 ? '#22c55e' : '#14532d') : '#0f2a1a';
        c.fillRect(x + 4, y + 7 + u * 12, 2, 2);
        c.fillStyle = on && load > 0.5 ? '#f59e0b' : '#3b2a0b';
        c.fillRect(x + 8, y + 7 + u * 12, 2, 2);
      }
    }
    c.fillStyle = '#94a3b8';
    c.font = '7px monospace';
    c.fillText(`${this.runningTasks} running`, (r.x + 1) * TILE, (r.y + 10.6) * TILE);
  }

  private drawMonitors(c: CanvasRenderingContext2D, t: number) {
    for (const s of this.sprites.values()) {
      const d = s.seat.desk;
      const sx = d.x * TILE + 8;
      const sy = d.y * TILE - 4;
      const atDesk = s.goal === 'desk' && !s.moving;
      const a = s.agent.activity;
      if (!atDesk || !WORK.has(a) || s.agent.paused) {
        c.fillStyle = '#0b1120';
        c.fillRect(sx, sy, 16, 10);
        continue;
      }
      const bg = a === 'error' ? '#450a0a' : a === 'completed' ? '#052e16' : '#020617';
      c.fillStyle = bg;
      c.fillRect(sx, sy, 16, 10);
      if (a === 'coding') {
        const colors = ['#22c55e', '#38bdf8', '#f472b6', '#facc15', '#a78bfa'];
        const scroll = Math.floor(t * 6);
        for (let l = 0; l < 4; l++) {
          const seed = (scroll + l) * 7919 + d.x * 31;
          c.fillStyle = colors[seed % colors.length];
          c.fillRect(sx + 1 + (seed % 3), sy + 1 + l * 2.3, 4 + (seed % 9), 1);
        }
      } else if (a === 'writing' || a === 'working') {
        const lines = Math.floor(t * 2) % 5;
        c.fillStyle = '#e2e8f0';
        for (let l = 0; l < lines; l++) c.fillRect(sx + 1, sy + 1 + l * 2, l === lines - 1 ? 6 : 13, 1);
      } else if (a === 'reading') {
        c.fillStyle = '#f8fafc';
        c.fillRect(sx + 3, sy + 1, 10, 8);
        c.fillStyle = '#64748b';
        const off = Math.floor(t * 3) % 3;
        for (let l = 0; l < 3; l++) c.fillRect(sx + 4, sy + 2 + ((l + off) % 3) * 2, 8, 1);
      } else if (a === 'thinking' || a === 'waiting') {
        if (Math.floor(t * 2) % 2) {
          c.fillStyle = '#94a3b8';
          c.fillRect(sx + 2, sy + 7, 3, 1);
        }
      } else if (a === 'error') {
        c.fillStyle = '#ef4444';
        c.fillRect(sx + 7, sy + 2, 2, 4);
        c.fillRect(sx + 7, sy + 7, 2, 1);
      } else if (a === 'completed') {
        c.fillStyle = '#4ade80';
        c.fillRect(sx + 4, sy + 5, 2, 2);
        c.fillRect(sx + 6, sy + 6, 2, 2);
        c.fillRect(sx + 8, sy + 4, 2, 2);
        c.fillRect(sx + 10, sy + 2, 2, 2);
      }
      // glow
      c.fillStyle = 'rgba(148,163,184,.06)';
      c.fillRect(sx - 2, sy + 10, 20, 6);
    }
  }

  private drawLinks(c: CanvasRenderingContext2D, t: number) {
    for (const l of this.links) {
      const a = this.sprites.get(l.a);
      const b = this.sprites.get(l.b);
      if (!a || !b) continue;
      c.save();
      c.strokeStyle = 'rgba(251,191,36,.75)';
      c.lineWidth = 1;
      c.setLineDash([3, 3]);
      c.lineDashOffset = -t * 20;
      c.beginPath();
      c.moveTo(a.x, a.y - 12);
      c.lineTo(b.x, b.y - 12);
      c.stroke();
      c.restore();
      // travelling envelope
      const k = (t * 0.6) % 1;
      const ex = a.x + (b.x - a.x) * k;
      const ey = a.y - 12 + (b.y - a.y) * k;
      c.fillStyle = '#fde68a';
      c.fillRect(ex - 3, ey - 2, 6, 4);
      c.fillStyle = '#b45309';
      c.fillRect(ex - 3, ey - 2, 6, 1);
    }
  }

  // ------------------------------------------------------------------ characters
  private drawAgent(c: CanvasRenderingContext2D, s: Sprite, t: number) {
    const a = s.agent;
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    const seated = !s.moving && s.goal === 'desk';
    const facing = s.moving ? s.dir : seated ? 'up' : 'down';
    const skin = SKIN[(a.hair + a.name.length) % SKIN.length];
    const hair = HAIR[a.hair % HAIR.length];
    const dim = a.paused || !a.enabled;
    c.globalAlpha = dim ? 0.45 : 1;

    // selection / hover ring
    if (this.selected === a.id || this.hover === a.id) {
      c.strokeStyle = this.selected === a.id ? '#818cf8' : 'rgba(255,255,255,.5)';
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(x, y, 9, 4, 0, 0, Math.PI * 2);
      c.stroke();
    }
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.beginPath();
    c.ellipse(x, y, 6, 2.5, 0, 0, Math.PI * 2);
    c.fill();

    const bob = s.moving ? Math.round(Math.sin(s.walk) * 1) : 0;
    // legs
    c.fillStyle = '#1e293b';
    if (s.moving) {
      const l = Math.sin(s.walk) > 0 ? 1 : -1;
      c.fillRect(x - 3, y - 6 + (l > 0 ? 0 : 1), 2, 5);
      c.fillRect(x + 1, y - 6 + (l > 0 ? 1 : 0), 2, 5);
    } else if (!seated) {
      c.fillRect(x - 3, y - 6, 2, 5);
      c.fillRect(x + 1, y - 6, 2, 5);
    }
    // body
    const bodyY = y - 13 + bob + (seated ? 3 : 0);
    c.fillStyle = a.color;
    c.fillRect(x - 4, bodyY, 8, 7);
    c.fillStyle = 'rgba(0,0,0,.18)';
    c.fillRect(x - 4, bodyY + 5, 8, 2);
    // arms
    c.fillStyle = a.color;
    const typing = seated && ['coding', 'writing', 'working'].includes(a.activity) && !a.paused;
    if (typing) {
      const k = Math.floor(t * 8) % 2;
      c.fillRect(x - 6, bodyY + 1 - k, 2, 4);
      c.fillRect(x + 4, bodyY + k, 2, 4);
    } else {
      c.fillRect(x - 6, bodyY + 1, 2, 5);
      c.fillRect(x + 4, bodyY + 1, 2, 5);
    }
    if (a.activity === 'reading' && seated) {
      c.fillStyle = '#f8fafc';
      c.fillRect(x - 5, bodyY - 1, 10, 3);
    }
    // head
    const headY = bodyY - 8;
    c.fillStyle = skin;
    c.fillRect(x - 4, headY, 8, 8);
    c.fillStyle = hair;
    if (facing === 'up') c.fillRect(x - 4, headY, 8, 7);
    else {
      c.fillRect(x - 4, headY, 8, 3);
      c.fillRect(x - 4, headY + 3, 1, 3);
      c.fillRect(x + 3, headY + 3, 1, 3);
      c.fillStyle = '#111827';
      if (facing === 'down') {
        c.fillRect(x - 2, headY + 4, 1, 1);
        c.fillRect(x + 1, headY + 4, 1, 1);
      } else c.fillRect(facing === 'left' ? x - 3 : x + 2, headY + 4, 1, 1);
    }
    c.globalAlpha = 1;
  }

  private drawOverlay(c: CanvasRenderingContext2D, s: Sprite, t: number) {
    const a = s.agent;
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    const headTop = y - 24 + (!s.moving && s.goal === 'desk' ? 3 : 0);
    // name tag
    c.font = '7px monospace';
    c.textBaseline = 'top';
    const name = a.name.length > 14 ? `${a.name.slice(0, 13)}…` : a.name;
    const w = c.measureText(name).width + 4;
    c.fillStyle = 'rgba(8,10,18,.75)';
    c.fillRect(x - w / 2, y + 3, w, 9);
    c.fillStyle = this.selected === a.id ? '#c7d2fe' : '#e2e8f0';
    c.fillText(name, x - w / 2 + 2, y + 4);

    if (a.paused) return this.bubble(c, x, headTop, '#475569', () => this.text(c, x, headTop - 9, 'II', '#e2e8f0'));
    switch (a.activity) {
      case 'thinking': {
        const dots = Math.floor(t * 3) % 4;
        this.bubble(c, x, headTop, '#e2e8f0', () => {
          for (let i = 0; i < dots; i++) {
            c.fillStyle = '#475569';
            c.fillRect(x - 5 + i * 4, headTop - 9, 2, 2);
          }
        });
        break;
      }
      case 'coding':
        this.bubble(c, x, headTop, '#064e3b', () => this.text(c, x, headTop - 11, '</>', '#6ee7b7'));
        break;
      case 'writing':
        this.bubble(c, x, headTop, '#831843', () => this.text(c, x, headTop - 11, '✎', '#fbcfe8'));
        break;
      case 'reading':
        this.bubble(c, x, headTop, '#164e63', () => {
          c.fillStyle = '#f8fafc';
          c.fillRect(x - 5, headTop - 11, 4, 6);
          c.fillRect(x + 1, headTop - 11, 4, 6);
          c.fillStyle = '#0e7490';
          c.fillRect(x, headTop - 11, 1, 6);
        });
        break;
      case 'working': {
        const ang = t * 3;
        this.bubble(c, x, headTop, '#0c4a6e', () => {
          c.fillStyle = '#7dd3fc';
          for (let i = 0; i < 4; i++) c.fillRect(x - 1 + Math.round(Math.cos(ang + (i * Math.PI) / 2) * 3), headTop - 9 + Math.round(Math.sin(ang + (i * Math.PI) / 2) * 3), 2, 2);
        });
        break;
      }
      case 'discussing':
        this.bubble(c, x, headTop, '#78350f', () => {
          c.fillStyle = '#fde68a';
          const k = Math.floor(t * 4) % 3;
          for (let i = 0; i <= k; i++) c.fillRect(x - 5, headTop - 12 + i * 3, 10 - i * 3, 1);
        });
        break;
      case 'waiting':
        this.bubble(c, x, headTop, '#7c2d12', () => this.text(c, x, headTop - 11, '⌛', '#fed7aa'));
        break;
      case 'error':
        if (Math.floor(t * 3) % 2 === 0) this.bubble(c, x, headTop, '#7f1d1d', () => this.text(c, x, headTop - 11, '!', '#fecaca'));
        break;
      case 'completed':
        this.bubble(c, x, headTop, '#14532d', () => this.text(c, x, headTop - 11, '✓', '#bbf7d0'));
        break;
      case 'idle':
        if (s.goal === 'coffee' && !s.moving) this.text(c, x + 6, headTop - 6, '☕', '#fde68a');
        else if (!s.moving) {
          const k = (t * 0.5 + a.name.length) % 3;
          c.globalAlpha = Math.max(0, 1 - k / 3);
          this.text(c, x + 6, headTop - 2 - k * 4, 'z', '#94a3b8');
          c.globalAlpha = 1;
        }
        break;
    }
    // transient effects
    const now = t;
    s.fx = s.fx.filter((f) => now - f.t0 < 2.5);
    for (const f of s.fx) {
      const k = now - f.t0;
      c.globalAlpha = Math.max(0, 1 - k / 2.5);
      this.text(c, x, headTop - 18 - k * 10, f.kind === 'done' ? 'Done!' : 'Error', f.kind === 'done' ? '#4ade80' : '#f87171');
      c.globalAlpha = 1;
    }
    // hover tooltip
    if (this.hover === a.id && a.detail) {
      const d = a.detail.length > 46 ? `${a.detail.slice(0, 45)}…` : a.detail;
      const tw = c.measureText(d).width + 6;
      const tx = Math.min(Math.max(2, x - tw / 2), W - tw - 2);
      c.fillStyle = 'rgba(15,23,42,.95)';
      c.fillRect(tx, y + 13, tw, 10);
      c.fillStyle = '#cbd5e1';
      c.fillText(d, tx + 3, y + 14);
    }
  }

  private bubble(c: CanvasRenderingContext2D, x: number, top: number, color: string, inner: () => void) {
    c.fillStyle = color;
    c.fillRect(x - 8, top - 14, 16, 11);
    c.fillRect(x - 1, top - 3, 2, 2);
    c.fillStyle = 'rgba(255,255,255,.15)';
    c.fillRect(x - 8, top - 14, 16, 1);
    inner();
  }

  private text(c: CanvasRenderingContext2D, x: number, y: number, s: string, color: string) {
    c.font = '8px monospace';
    c.textBaseline = 'top';
    c.fillStyle = color;
    const w = c.measureText(s).width;
    c.fillText(s, Math.round(x - w / 2), Math.round(y));
  }
}

const seatCache = new Map<string, Seat[]>();
function seatsFor(room: string): Seat[] {
  if (!seatCache.has(room)) seatCache.set(room, deskSeats(roomById(room)));
  return seatCache.get(room)!;
}

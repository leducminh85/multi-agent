/**
 * Virtual office floor plan (tile units). Pure data + pure functions so it is testable and
 * renderer-agnostic (Canvas today; PixiJS/Phaser could consume the same layout).
 */
export const TILE = 16;
export const COLS = 48;
export const ROWS = 28;
export const CORRIDOR_Y = 13; // corridor occupies rows 12..14

export type RoomId = 'manager' | 'main' | 'meeting' | 'server' | 'research' | 'development' | 'design' | 'content';

export interface Room {
  id: RoomId;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floor: [string, string];
  wall: string;
}

export const ROOMS: Room[] = [
  { id: 'manager', name: 'Manager Office', x: 0, y: 0, w: 10, h: 12, floor: ['#3b2f4a', '#43354f'], wall: '#251c33' },
  { id: 'main', name: 'Main Office', x: 10, y: 0, w: 18, h: 12, floor: ['#2b3550', '#2f3a57'], wall: '#1b2238' },
  { id: 'meeting', name: 'Meeting Room', x: 28, y: 0, w: 12, h: 12, floor: ['#3a3326', '#40382a'], wall: '#251f16' },
  { id: 'server', name: 'Server Room', x: 40, y: 0, w: 8, h: 12, floor: ['#1d2a2e', '#203034'], wall: '#111a1d' },
  { id: 'research', name: 'Research', x: 0, y: 15, w: 12, h: 13, floor: ['#23363a', '#273c40'], wall: '#14221f' },
  { id: 'development', name: 'Development', x: 12, y: 15, w: 12, h: 13, floor: ['#1f3326', '#23392b'], wall: '#13201a' },
  { id: 'design', name: 'Design', x: 24, y: 15, w: 12, h: 13, floor: ['#3a2836', '#402c3b'], wall: '#241722' },
  { id: 'content', name: 'Content', x: 36, y: 15, w: 12, h: 13, floor: ['#3a3024', '#403528'], wall: '#241c13' },
];

export const roomById = (id: string): Room => ROOMS.find((r) => r.id === id) ?? ROOMS[1];

export interface Seat {
  room: RoomId;
  /** where the character sits (pixel coords, feet) */
  x: number;
  y: number;
  /** desk rectangle (tiles) */
  desk: { x: number; y: number; w: number; h: number };
}

/** Desk seats for a room: a grid of desks, 2 tiles wide, rows 3 tiles apart. */
export function deskSeats(room: Room): Seat[] {
  if (room.id === 'meeting' || room.id === 'server') return [];
  const seats: Seat[] = [];
  // Manager office keeps space for the manager's desk; main office keeps a lounge corner.
  const cols = room.id === 'main' ? 3 : Math.max(1, Math.floor((room.w - 2) / 4));
  const rowsAvail = room.id === 'manager' ? 1 : Math.max(1, Math.floor((room.h - 3) / 3));
  for (let r = 0; r < rowsAvail; r++) {
    for (let c = 0; c < cols; c++) {
      const dx = room.x + 1 + c * 4 + 1;
      const dy = room.y + 2 + r * 3;
      seats.push({ room: room.id, desk: { x: dx, y: dy, w: 2, h: 1 }, x: (dx + 1) * TILE, y: (dy + 2) * TILE + 2 });
    }
  }
  return seats;
}

/** Seats around the meeting table. */
export function meetingSeats(): { x: number; y: number }[] {
  const room = roomById('meeting');
  const cx = room.x + room.w / 2;
  const top = room.y + 4;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < 4; i++) {
    out.push({ x: (cx - 3 + i * 2) * TILE, y: (top - 0.2) * TILE });
    out.push({ x: (cx - 3 + i * 2) * TILE, y: (top + 4.6) * TILE });
  }
  return out;
}

export const DEPARTMENT_ROOM: Record<string, RoomId> = {
  manager: 'manager',
  main: 'main',
  research: 'research',
  development: 'development',
  design: 'design',
  content: 'content',
  meeting: 'main',
  server: 'main',
};

/**
 * Deterministically assign every agent a desk in its department room. Overflow goes to the
 * main office, then any free desk; beyond capacity seats are reused with an offset.
 */
export function assignSeats(agents: { id: string; department: string }[]): Map<string, Seat> {
  const free = new Map<RoomId, Seat[]>();
  for (const r of ROOMS) free.set(r.id, deskSeats(r));
  const result = new Map<string, Seat>();
  const sorted = [...agents].sort((a, b) => a.id.localeCompare(b.id));
  const take = (room: RoomId) => free.get(room)?.shift();
  for (const a of sorted) {
    const room = DEPARTMENT_ROOM[a.department] ?? 'main';
    let seat = take(room) ?? take('main');
    if (!seat) for (const r of ROOMS) if ((seat = take(r.id))) break;
    if (!seat) {
      const base = deskSeats(roomById('main'));
      const s = base[result.size % base.length];
      seat = { ...s, x: s.x + ((result.size % 3) - 1) * 10 };
    }
    result.set(a.id, seat);
  }
  return result;
}

/** Waypoints between two points: rooms connect through the corridor via their door column. */
export function route(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] {
  const ry = (y: number) => (y < (CORRIDOR_Y - 1) * TILE ? 'top' : y > (CORRIDOR_Y + 2) * TILE ? 'bottom' : 'corridor');
  const roomOf = (p: { x: number; y: number }) => ROOMS.find((r) => p.x >= r.x * TILE && p.x < (r.x + r.w) * TILE && p.y >= r.y * TILE && p.y < (r.y + r.h) * TILE);
  const a = roomOf(from);
  const b = roomOf(to);
  if (a && b && a.id === b.id) return [to];
  const corridor = (CORRIDOR_Y + 0.5) * TILE;
  const doorX = (r: Room | undefined, p: { x: number }) => (r ? (r.x + r.w / 2) * TILE : p.x);
  const pts: { x: number; y: number }[] = [];
  if (ry(from.y) !== 'corridor') {
    pts.push({ x: doorX(a, from), y: from.y });
    pts.push({ x: doorX(a, from), y: corridor });
  }
  if (ry(to.y) !== 'corridor') {
    pts.push({ x: doorX(b, to), y: corridor });
    pts.push({ x: doorX(b, to), y: to.y });
  }
  pts.push(to);
  return pts;
}

import { describe, expect, it } from 'vitest';
import { assignSeats, deskSeats, meetingSeats, roomById, route, ROOMS, TILE } from './layout';

describe('office layout', () => {
  it('has the eight required areas', () => {
    expect(ROOMS.map((r) => r.id).sort()).toEqual(['content', 'design', 'development', 'main', 'manager', 'meeting', 'research', 'server'].sort());
  });

  it('places agents at desks inside their department room', () => {
    const seats = assignSeats([
      { id: 'a', department: 'development' },
      { id: 'b', department: 'development' },
      { id: 'c', department: 'research' },
    ]);
    const dev = roomById('development');
    for (const id of ['a', 'b']) {
      const s = seats.get(id)!;
      expect(s.room).toBe('development');
      expect(s.x).toBeGreaterThanOrEqual(dev.x * TILE);
      expect(s.x).toBeLessThan((dev.x + dev.w) * TILE);
    }
    expect(seats.get('a')).not.toEqual(seats.get('b'));
    expect(seats.get('c')!.room).toBe('research');
  });

  it('overflows to other rooms instead of stacking agents', () => {
    const capacity = deskSeats(roomById('design')).length;
    const agents = Array.from({ length: capacity + 2 }, (_, i) => ({ id: `d${i}`, department: 'design' }));
    const seats = assignSeats(agents);
    const keys = new Set([...seats.values()].map((s) => `${s.x},${s.y}`));
    expect(keys.size).toBe(agents.length);
  });

  it('routes between rooms through the corridor', () => {
    const from = { x: 20 * TILE, y: 5 * TILE };
    const to = { x: 30 * TILE, y: 20 * TILE };
    const pts = route(from, to);
    expect(pts.at(-1)).toEqual(to);
    expect(pts.length).toBeGreaterThan(2);
    expect(route(from, { x: 21 * TILE, y: 6 * TILE })).toHaveLength(1);
  });

  it('provides meeting seats', () => {
    expect(meetingSeats().length).toBe(8);
  });
});

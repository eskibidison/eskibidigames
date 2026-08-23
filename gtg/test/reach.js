// Grid flood fill and pathfinding over the game's own collision function, so
// the bots walk around exactly the obstacles the player would.
const GRID = 20;          // cell size in world pixels
const BODY = 14;          // the player's collision radius
const LO = -8;            // grid bounds, a little outside the hedge
const HI = 412;

const cellKey = (cx, cy) => cx + ':' + cy;
const toCell = v => Math.round(v / GRID);
const key = p => cellKey(toCell(p.x), toCell(p.y));

function walkableFn(g) {
  const blocked = g.context.__blocked;
  const cache = new Map();
  return (cx, cy) => {
    if (cx < LO || cy < LO || cx > HI || cy > HI) return false;
    const k = cellKey(cx, cy);
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    const ok = !blocked(cx * GRID, cy * GRID, BODY);
    cache.set(k, ok);
    return ok;
  };
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Every cell reachable on foot from the player's current position.
function reachable(g) {
  const walkable = walkableFn(g);
  const p = g.probe().player;
  const start = [toCell(p.x), toCell(p.y)];
  const seen = new Set([cellKey(start[0], start[1])]);
  const queue = [start];
  while (queue.length) {
    const [cx, cy] = queue.shift();
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx, ny = cy + dy;
      const k = cellKey(nx, ny);
      if (seen.has(k) || !walkable(nx, ny)) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

// Nearest walkable cell to a point, in case a target sits tight against a wall.
function anchor(walkable, x, y) {
  const cx = toCell(x), cy = toCell(y);
  if (walkable(cx, cy)) return [cx, cy];
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (walkable(cx + dx, cy + dy)) return [cx + dx, cy + dy];
      }
    }
  }
  return null;
}

// Waypoints from the player to a target, or null when there is no way through.
function path(g, from, to) {
  const walkable = walkableFn(g);
  const start = anchor(walkable, from.x, from.y);
  const goal = anchor(walkable, to.x, to.y);
  if (!start || !goal) return null;

  const goalKey = cellKey(goal[0], goal[1]);
  const parent = new Map([[cellKey(start[0], start[1]), null]]);
  const queue = [start];
  let head = 0;
  let found = false;

  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    if (cellKey(cx, cy) === goalKey) { found = true; break; }
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx, ny = cy + dy;
      const k = cellKey(nx, ny);
      if (parent.has(k) || !walkable(nx, ny)) continue;
      parent.set(k, cellKey(cx, cy));
      queue.push([nx, ny]);
    }
  }
  if (!found) return null;

  const out = [];
  let k = goalKey;
  while (k) {
    const [cx, cy] = k.split(':').map(Number);
    out.push({ x: cx * GRID, y: cy * GRID });
    k = parent.get(k);
  }
  out.reverse();
  out.push({ x: to.x, y: to.y });
  return out;
}

module.exports = { reachable, path, key, toCell, GRID };

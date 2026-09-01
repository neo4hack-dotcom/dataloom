// Generic layered/Sugiyama-style DAG layout — shared by the table-level Lineage
// view and the column-level Impact Analysis view. Operates purely on ids/edges,
// no knowledge of what a node represents.
export interface GraphLayout {
  nodes: Record<string, { x: number; y: number; w: number; h: number }>;
  height: number;
}

export function buildLayout(
  ids: string[],
  edges: { from: string; to: string }[],
  opts: { nodeW?: number; nodeH?: number; gapX?: number; gapY?: number; pad?: number } = {}
): GraphLayout {
  const NODE_W = opts.nodeW ?? 150, NODE_H = opts.nodeH ?? 44;
  const GAP_X = opts.gapX ?? 200, GAP_Y = opts.gapY ?? 16, PAD = opts.pad ?? 20;
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  ids.forEach((id) => { adj.set(id, []); indeg.set(id, 0); });
  for (const e of edges) {
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const level = new Map<string, number>();
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  queue.forEach((id) => level.set(id, 0));
  const work = [...queue];
  const localIndeg = new Map(indeg);
  while (work.length) {
    const id = work.shift()!;
    for (const nb of adj.get(id) ?? []) {
      level.set(nb, Math.max(level.get(nb) ?? 0, (level.get(id) ?? 0) + 1));
      localIndeg.set(nb, (localIndeg.get(nb) ?? 1) - 1);
      if ((localIndeg.get(nb) ?? 0) <= 0) work.push(nb);
    }
  }
  ids.forEach((id) => { if (!level.has(id)) level.set(id, 0); });
  const byLevel = new Map<number, string[]>();
  ids.forEach((id) => {
    const l = level.get(id)!;
    (byLevel.get(l) ?? byLevel.set(l, []).get(l)!).push(id);
  });
  const nodes: Record<string, { x: number; y: number; w: number; h: number }> = {};
  let maxY = 0;
  for (const [l, group] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    group.forEach((id, i) => {
      const x = PAD + l * GAP_X;
      const y = PAD + i * (NODE_H + GAP_Y);
      nodes[id] = { x, y, w: NODE_W, h: NODE_H };
      maxY = Math.max(maxY, y + NODE_H);
    });
  }
  return { nodes, height: maxY + PAD };
}

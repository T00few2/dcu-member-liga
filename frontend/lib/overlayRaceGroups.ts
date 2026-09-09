export type OverlayRaceGroup = {
  id?: string;
  name?: string;
  eventId?: string;
  eventSecret?: string;
  laps?: number;
  sprints?: unknown[];
  segmentType?: string;
  categories?: Array<{
    category?: string;
    laps?: number;
    sprints?: unknown[];
    segmentType?: string;
  }>;
};

function normName(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function overlayRaceGroups(
  template: OverlayRaceGroup[] | null | undefined,
  raceGroups: OverlayRaceGroup[] | null | undefined,
): { next: OverlayRaceGroup[]; diff: { droppedEventIds: { group?: string; eventId: string }[]; warnings: string[] } } {
  const race = (raceGroups || []).map((g) => ({ ...g, categories: [...(g.categories || [])] }));
  const used = new Set<number>();
  const next: OverlayRaceGroup[] = [];
  const droppedEventIds: { group?: string; eventId: string }[] = [];
  const warnings: string[] = [];

  const findMatch = (tg: OverlayRaceGroup): number | null => {
    const tname = normName(tg.name);
    const tid = String(tg.id || '').trim();
    if (tname) {
      for (let i = 0; i < race.length; i++) {
        if (used.has(i)) continue;
        if (normName(race[i].name) === tname) return i;
      }
    }
    if (tid) {
      for (let i = 0; i < race.length; i++) {
        if (used.has(i)) continue;
        if (String(race[i].id || '').trim() === tid) return i;
      }
    }
    return null;
  };

  for (const tg of template || []) {
    const tCats = (tg.categories || []).filter((c) => c && String(c.category || '').trim());
    const idx = findMatch(tg);
    if (idx == null) {
      next.push({
        id: tg.id || '',
        name: tg.name || '',
        eventId: '',
        eventSecret: '',
        laps: tg.laps,
        sprints: [],
        segmentType: 'sprint',
        categories: tCats.map((c) => ({ category: String(c.category), sprints: [] })),
      });
      continue;
    }
    used.add(idx);
    const rg = race[idx];
    const oldByNorm = new Map<string, NonNullable<OverlayRaceGroup['categories']>[number]>();
    for (const cat of rg.categories || []) {
      const key = normName(cat.category);
      if (key && !oldByNorm.has(key)) oldByNorm.set(key, cat);
    }
    const newCats = tCats.map((tcat) => {
      const name = String(tcat.category || '').trim();
      const old = oldByNorm.get(normName(name));
      if (old) return { ...old, category: name };
      return { category: name, sprints: [] };
    });
    next.push({ ...rg, name: tg.name || rg.name, categories: newCats });
  }

  race.forEach((rg, i) => {
    if (used.has(i)) return;
    const eventId = String(rg.eventId || '').trim();
    if (eventId) {
      droppedEventIds.push({ group: rg.name, eventId });
      warnings.push(`Group ${JSON.stringify(rg.name)} has no template match and would drop eventId ${eventId}`);
    }
  });

  return { next, diff: { droppedEventIds, warnings } };
}

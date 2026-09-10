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

function hasSprints(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

export function overlayRaceGroups(
  template: OverlayRaceGroup[] | null | undefined,
  raceGroups: OverlayRaceGroup[] | null | undefined,
): {
  next: OverlayRaceGroup[];
  diff: {
    droppedEventIds: { group?: string; eventId: string }[];
    warnings: string[];
    droppedGroupsWithSprints: unknown[];
  };
} {
  const race = (raceGroups || []).map((g) => ({ ...g, categories: [...(g.categories || [])] }));
  const used = new Set<number>();
  const next: OverlayRaceGroup[] = [];
  const droppedEventIds: { group?: string; eventId: string }[] = [];
  const warnings: string[] = [];
  const droppedGroupsWithSprints: unknown[] = [];

  const catByNorm = new Map<string, NonNullable<OverlayRaceGroup['categories']>[number]>();
  const groupSprintsByCat = new Map<string, unknown[]>();
  for (const rg of race) {
    const groupSprints = Array.isArray(rg.sprints) ? rg.sprints : [];
    for (const cat of rg.categories || []) {
      const key = normName(cat.category);
      if (!key) continue;
      if (!catByNorm.has(key)) catByNorm.set(key, cat);
      if (hasSprints(groupSprints) && !groupSprintsByCat.has(key)) {
        groupSprintsByCat.set(key, groupSprints);
      }
    }
  }

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

  const catsForTemplate = (tCats: NonNullable<OverlayRaceGroup['categories']>): NonNullable<OverlayRaceGroup['categories']> =>
    tCats.map((tcat) => {
      const name = String(tcat.category || '').trim();
      const old = catByNorm.get(normName(name));
      if (old) return { ...old, category: name };
      return { category: name, sprints: [] };
    });

  const fillGroupSprints = (group: OverlayRaceGroup, names: string[]) => {
    if (hasSprints(group.sprints)) return;
    for (const name of names) {
      const src = groupSprintsByCat.get(normName(name));
      if (hasSprints(src)) {
        group.sprints = [...(src || [])];
        return;
      }
    }
  };

  for (const tg of template || []) {
    const tCats = (tg.categories || []).filter((c) => c && String(c.category || '').trim());
    const tNames = tCats.map((c) => String(c.category || '').trim());
    const idx = findMatch(tg);
    if (idx == null) {
      const newG: OverlayRaceGroup = {
        id: tg.id || '',
        name: tg.name || '',
        eventId: '',
        eventSecret: '',
        laps: tg.laps,
        sprints: [],
        segmentType: 'sprint',
        categories: catsForTemplate(tCats),
      };
      fillGroupSprints(newG, tNames);
      next.push(newG);
      continue;
    }
    used.add(idx);
    const rg = race[idx];
    const nextG: OverlayRaceGroup = { ...rg, name: tg.name || rg.name, categories: catsForTemplate(tCats) };
    fillGroupSprints(nextG, tNames);
    next.push(nextG);
  }

  race.forEach((rg, i) => {
    if (used.has(i)) return;
    const eventId = String(rg.eventId || '').trim();
    if (eventId) {
      droppedEventIds.push({ group: rg.name, eventId });
      warnings.push(`Group ${JSON.stringify(rg.name)} has no template match and would drop eventId ${eventId}`);
    }
    const hadSprints = hasSprints(rg.sprints) || (rg.categories || []).some((c) => hasSprints(c.sprints));
    if (hadSprints) droppedGroupsWithSprints.push(rg.name);
  });

  return { next, diff: { droppedEventIds, warnings, droppedGroupsWithSprints } };
}

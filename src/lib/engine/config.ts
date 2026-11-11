import sectorsJson from '@/data/sectors.provisional.geojson.json';
import type { GameConfig, Landmark, SectorCollection } from './types';
import { sectorCentroid } from './geo';

/** Timings straight from the brief. Speed only changes in simulation games. */
export const DEFAULT_CONFIG: GameConfig = {
  mode: 'multi',
  sharedSector: null,
  openSector: null,
  headStartSec: 120,
  voteEverySec: 600,
  voteDurationSec: 120,
  closeGraceSec: 180,
  zoneEverySec: 180,
  zoneDurationSec: 60,
  zoneStages: 3,
  zoneStartRadiusM: 110,
  zoneMinRadiusM: 45,
  photoEverySec: 300,
  photoWindowSec: 120,
  clueDurationSec: 60,
  clueRadiusM: 60,
  violation: 'clue',
  separationM: 35,
  separationHoldSec: 20,
  staleSec: 45,
  replayRetentionHours: 24,
  sectorsVerified: false,
  speed: 1,
  seekerStartNote: '',
};

export const SIM_SPEEDS = [1, 5, 10, 30] as const;

/** Provisional sectors traced from satellite imagery against the user's annotated guide map. NOT verified on-site. */
export const PROVISIONAL_SECTORS = sectorsJson as unknown as SectorCollection;

/** Provisional landmarks from the brief. All unverified; positions are only the sector centre. */
export function provisionalLandmarks(fc: SectorCollection = PROVISIONAL_SECTORS): Landmark[] {
  const list: [number, string][] = [
    [2, 'Psycho Bunny'], [3, 'TowneBank'], [4, 'Shake Shack'], [4, 'Five Below'], [5, 'Regal Theatre'],
    [6, 'Abercrombie & Fitch'], [7, 'Fountain'], [8, 'TASTE'],
  ];
  return list.map(([sector, name], i) => {
    const f = fc.features.find((x) => x.properties.sector === sector)!;
    const c = sectorCentroid(f);
    return { id: `lm${i + 1}`, name, sector, lat: c.lat + (i % 2 ? 0.00008 : -0.00008), lon: c.lon, verified: false };
  });
}

/** Guide-style arrangement used by vote grids (Independence Blvd at the top, VB Blvd on the right). */
export const SECTOR_GRID: number[][] = [[9, 10, 1], [8, 7, 2], [6, 3], [5, 4]];

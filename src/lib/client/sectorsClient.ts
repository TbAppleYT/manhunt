import { PROVISIONAL_SECTORS } from '@/lib/engine/config';
import { sectorCentroid } from '@/lib/engine/geo';
export const center = (n: number) => sectorCentroid(PROVISIONAL_SECTORS.features.find((f) => f.properties.sector === n)!);

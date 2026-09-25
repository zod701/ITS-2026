export type DemandPeriod = "annual" | "danoje";
export interface StationTotals {
  name: string;
  sttn_id: string;
  annual_2025_ride_nope: number | null;
  annual_2025_goff_nope: number | null;
  danoje_ride_nope: number | null;
  danoje_goff_nope: number | null;
  danoje_days_with_record: number;
  danoje_days_supplied: number;
}
export interface BisRoute {
  id: string;
  name: string;
  company: string;
  start: string;
  end: string;
  segments: [number, number][][];
  demandRanges: Record<DemandPeriod, [number, number]>;
  demandTotals: Record<DemandPeriod, number | null>;
  stops: { id: string; name: string; order: string; coordinates: [number, number];
    stationTotals: StationTotals;
    demand: Record<DemandPeriod, [number, number] | null> }[];
}

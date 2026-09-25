import type { BisRoute, DemandPeriod } from "./bisRoutes";

export function routeNetDemandMaximum(route: BisRoute, period: DemandPeriod): number {
  return Math.max(0, ...route.stops.map((stop) => {
    const counts = stop.demand[period];
    return counts == null ? 0 : Math.abs(counts[0] - counts[1]);
  }));
}

/** Local stop activity, not onboard passenger load. Radius is in metres. */
export function routeDemandColors(route: BisRoute, period: DemandPeriod): string[][] {
  const stops = [...new Map(route.stops.map((s) => [s.id, s])).values()];
  const maximum = routeNetDemandMaximum(route, period);
  return route.segments.map((segment) => segment.map(([lon, lat]) => {
    let net = 0, weights = 0;
    for (const stop of stops) {
      const dx = (lon - stop.coordinates[0]) * 111320 * Math.cos(lat * Math.PI / 180);
      const dy = (lat - stop.coordinates[1]) * 111320;
      const distance = Math.hypot(dx, dy);
      const counts = stop.demand[period];
      if (distance >= 300 || counts == null) continue;
      const weight = (1 - distance / 300) ** 2;
      net += (counts[0] - counts[1]) * weight;
      weights += weight;
    }
    if (!weights) return "#808892";
    net /= weights;
    if (!net || !maximum) return "#e5e7eb";
    const intensity = Math.sqrt(Math.min(1, Math.abs(net) / maximum));
    const red = [239, 51, 64], blue = [37, 99, 235], neutral = [229, 231, 235];
    const color = net > 0 ? red : blue;
    return `rgb(${neutral.map((v, i) => Math.round(v * (1-intensity) + color[i]*intensity)).join(",")})`;
  }));
}

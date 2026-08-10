export interface SelectedPoint {
  pointId: string;
  panoId: string;
  lat: number;
  lon: number;
}

export interface PointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { point_id: string; pano_id: string };
}

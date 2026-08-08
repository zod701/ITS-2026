"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import type { SelectedPoint } from "../types";

const GANGNEUNG_BOUNDS: [[number, number], [number, number]] = [
  [37.7321168224, 128.8598787651],
  [37.811142202, 128.9546660985],
];

interface RoadFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { edge_id: string };
}

interface RoadsGeoJson {
  type: "FeatureCollection";
  features: RoadFeature[];
}

interface PointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { point_id: string; pano_id: string };
}

interface PointsGeoJson {
  type: "FeatureCollection";
  features: PointFeature[];
}

interface Props {
  onSelect: (point: SelectedPoint) => void;
}

function nearestPoint(
  points: PointFeature[],
  lat: number,
  lon: number
): PointFeature | null {
  let best: PointFeature | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const [plon, plat] = p.geometry.coordinates;
    const d = (plat - lat) ** 2 + (plon - lon) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

export default function MapView({ onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current).fitBounds(GANGNEUNG_BOUNDS);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    let points: PointFeature[] = [];

    fetch("/data/points.geojson")
      .then((res) => res.json())
      .then((data: PointsGeoJson) => {
        points = data.features;
      });

    fetch("/data/roads.geojson")
      .then((res) => res.json())
      .then((data: RoadsGeoJson) => {
        const roadsLayer = L.geoJSON(data as GeoJSON.GeoJsonObject, {
          style: {
            color: "#2563eb",
            weight: 4,
            opacity: 0.85,
          },
          onEachFeature: (_feature, layer) => {
            layer.on("mouseover", () => {
              (layer as L.Path).setStyle({ color: "#1d4ed8", weight: 6 });
            });
            layer.on("mouseout", () => {
              (layer as L.Path).setStyle({ color: "#2563eb", weight: 4 });
            });
            layer.on("click", (e: L.LeafletMouseEvent) => {
              if (points.length === 0) return;
              const nearest = nearestPoint(points, e.latlng.lat, e.latlng.lng);
              if (!nearest) return;
              const [lon, lat] = nearest.geometry.coordinates;
              onSelectRef.current({
                pointId: nearest.properties.point_id,
                panoId: nearest.properties.pano_id,
                lat,
                lon,
              });
            });
          },
        });
        roadsLayer.addTo(map);
      });

    return () => {
      map.remove();
    };
  }, []);

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
}

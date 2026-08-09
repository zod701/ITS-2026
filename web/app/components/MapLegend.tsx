"use client";

export type Grade = "Safe" | "Caution" | "High-risk";
export const GRADES: Grade[] = ["Safe", "Caution", "High-risk"];
export const NO_DATA_KEY = "no-data";
export type GradeFilterKey = Grade | typeof NO_DATA_KEY;

export const GRADE_COLORS: Record<Grade, string> = {
  Safe: "#22c55e",
  Caution: "#eab308",
  "High-risk": "#ef4444",
};
export const NO_DATA_COLOR = "#2563eb";

const GRADE_LABELS: Record<GradeFilterKey, string> = {
  Safe: "Safe",
  Caution: "Caution",
  "High-risk": "High-risk",
  [NO_DATA_KEY]: "데이터 없음",
};

interface Props {
  visible: Record<GradeFilterKey, boolean>;
  onToggle: (key: GradeFilterKey) => void;
  style?: React.CSSProperties;
}

export default function MapLegend({ visible, onToggle, style }: Props) {
  const keys: GradeFilterKey[] = [...GRADES, NO_DATA_KEY];

  return (
    <div className="map-legend" style={style}>
      {keys.map((key) => (
        <button
          key={key}
          className={`legend-item ${visible[key] ? "" : "legend-item-off"}`}
          onClick={() => onToggle(key)}
          aria-pressed={visible[key]}
        >
          <span
            className="legend-swatch"
            style={{ background: key === NO_DATA_KEY ? NO_DATA_COLOR : GRADE_COLORS[key] }}
          />
          {GRADE_LABELS[key]}
        </button>
      ))}

      <style jsx>{`
        .map-legend {
          position: absolute;
          z-index: 1000;
          background: var(--panel-bg);
          color: var(--foreground);
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          font-size: 13px;
        }
        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          border: none;
          background: none;
          color: inherit;
          font-size: inherit;
          font-family: inherit;
          cursor: pointer;
          padding: 2px 0;
          text-align: left;
          opacity: 1;
        }
        .legend-item-off {
          opacity: 0.4;
        }
        .legend-swatch {
          width: 14px;
          height: 14px;
          border-radius: 3px;
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}

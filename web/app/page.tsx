"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import GithubMarkdownButton from "./components/GithubMarkdownButton";
import PointDetailPanel from "./components/PointDetailPanel";
import ThemeToggle from "./components/ThemeToggle";
import type { SelectedPoint } from "./types";

const MapView = dynamic(() => import("./components/MapView"), { ssr: false });

export default function Home() {
  const [selected, setSelected] = useState<SelectedPoint | null>(null);

  return (
    <main style={{ position: "relative", height: "100vh", width: "100vw" }}>
      <MapView onSelect={setSelected} />
      {selected && (
        <PointDetailPanel point={selected} onClose={() => setSelected(null)} />
      )}
      <ThemeToggle style={{ right: 24, top: 24 }} />
      <GithubMarkdownButton
        filenames={["README.md", "readme.md"]}
        title="GitHub"
        icon="github"
        style={{ right: 88, bottom: 24 }}
      />
      <GithubMarkdownButton
        filenames={["method.md", "Method.md"]}
        title="Method"
        icon="doc"
        style={{ right: 24, bottom: 24 }}
      />
    </main>
  );
}

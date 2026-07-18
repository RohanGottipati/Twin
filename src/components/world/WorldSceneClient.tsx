"use client";

import dynamic from "next/dynamic";
import { SceneLoadingScreen } from "@/components/feedback/SceneLoadingScreen";

const WorldScene = dynamic(() => import("@/components/world/WorldScene"), {
  ssr: false,
  loading: () => <SceneLoadingScreen />,
});

export function WorldSceneClient() {
  return <WorldScene />;
}

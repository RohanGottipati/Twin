"use client";

import { createContext, useContext } from "react";

export type SceneController = {
  goToWorld: () => void;
  previewCity: (cityId: string) => void;
  exploreCity: (cityId: string) => void;
  goToCityOverview: () => void;
  goToCity: () => void;
  goToCityClose: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  resetNorth: () => void;
  toggleFullscreen: () => void;
  retry: () => void;
};

const noop = () => {};

const defaultController: SceneController = {
  goToWorld: noop,
  previewCity: noop,
  exploreCity: noop,
  goToCityOverview: noop,
  goToCity: noop,
  goToCityClose: noop,
  zoomIn: noop,
  zoomOut: noop,
  resetView: noop,
  resetNorth: noop,
  toggleFullscreen: noop,
  retry: noop,
};

export const SceneControllerContext =
  createContext<SceneController>(defaultController);

export function useSceneController(): SceneController {
  return useContext(SceneControllerContext);
}

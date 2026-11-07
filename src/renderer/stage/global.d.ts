import type { StageControls } from "./stageApi";

declare global {
  interface Window {
    pixvittaStage: StageControls;
  }
}

export {};

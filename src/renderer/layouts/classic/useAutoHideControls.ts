import { useAutoReveal } from "../../app/useAutoReveal";

const TOPBAR_HEIGHT_PX = 44;

function isOverTopBar(x: number, y: number): boolean {
  return y <= TOPBAR_HEIGHT_PX;
}

export function useAutoHideControls(enabled: boolean): boolean {
  return useAutoReveal(enabled, isOverTopBar);
}

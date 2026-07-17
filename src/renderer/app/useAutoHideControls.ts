import { useLayoutEffect, useRef, useState } from "react";

const FADE_DELAY_MS = 1200;
const TOPBAR_HEIGHT_PX = 44;

export function useAutoHideControls(enabled: boolean): boolean {
  const [isRevealed, setIsRevealed] = useState(true);
  const lastPointerYRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    let fadeTimer: number | undefined;
    const clearFadeTimer = () => {
      if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);
      fadeTimer = undefined;
    };
    const scheduleFade = () => {
      if (fadeTimer !== undefined) return;
      fadeTimer = window.setTimeout(() => { fadeTimer = undefined; setIsRevealed(false); }, FADE_DELAY_MS);
    };
    const handleMouseMove = (event: MouseEvent) => {
      lastPointerYRef.current = event.clientY;
      if (!enabled) return;
      if (event.clientY <= TOPBAR_HEIGHT_PX) { clearFadeTimer(); setIsRevealed(true); }
      else scheduleFade();
    };

    if (!enabled) setIsRevealed(true);
    else if (lastPointerYRef.current !== null && lastPointerYRef.current <= TOPBAR_HEIGHT_PX) setIsRevealed(true);
    else scheduleFade();

    window.addEventListener("mousemove", handleMouseMove);
    return () => { clearFadeTimer(); window.removeEventListener("mousemove", handleMouseMove); };
  }, [enabled]);

  return isRevealed;
}

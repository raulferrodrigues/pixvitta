import { useLayoutEffect, useRef, useState } from "react";

const FADE_DELAY_MS = 1200;

export type PointerArea = (x: number, y: number) => boolean;

// Controls start revealed and fade after a short idle. Moving the pointer into
// their area reveals them again and keeps them visible until it leaves.
export function useAutoReveal(enabled: boolean, isInArea: PointerArea): boolean {
  const [isRevealed, setIsRevealed] = useState(true);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const isInAreaRef = useRef(isInArea);

  useLayoutEffect(() => {
    isInAreaRef.current = isInArea;
  });

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
    const isPointerInArea = () => {
      const pointer = lastPointerRef.current;
      return pointer !== null && isInAreaRef.current(pointer.x, pointer.y);
    };
    const handleMouseMove = (event: MouseEvent) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      if (!enabled) return;
      if (isPointerInArea()) { clearFadeTimer(); setIsRevealed(true); }
      else scheduleFade();
    };

    if (!enabled) setIsRevealed(true);
    else if (isPointerInArea()) setIsRevealed(true);
    else scheduleFade();

    window.addEventListener("mousemove", handleMouseMove);
    return () => { clearFadeTimer(); window.removeEventListener("mousemove", handleMouseMove); };
  }, [enabled]);

  return isRevealed;
}

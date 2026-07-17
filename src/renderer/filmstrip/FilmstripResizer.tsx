import { useRef } from "react";
import { useGT } from "gt-react";
import { MAX_FILMSTRIP_WIDTH, MIN_FILMSTRIP_WIDTH } from "../state/viewerStore";
import { useViewerStore } from "../state/ViewerStoreProvider";

export function FilmstripResizer() {
  const gt = useGT();
  const filmstripWidth = useViewerStore((state) => state.filmstripWidth);
  const resizeFilmstrip = useViewerStore((state) => state.resizeFilmstrip);
  const isResizingRef = useRef(false);
  const pointerOffsetRef = useRef(0);

  return (
    <div
      className="filmstrip-resizer"
      role="separator"
      aria-label={gt("Resize filmstrip")}
      aria-orientation="vertical"
      aria-valuemin={MIN_FILMSTRIP_WIDTH}
      aria-valuemax={MAX_FILMSTRIP_WIDTH}
      aria-valuenow={filmstripWidth}
      data-testid="filmstrip-resizer"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        isResizingRef.current = true;
        pointerOffsetRef.current = filmstripWidth - event.clientX;
      }}
      onPointerMove={(event) => {
        if (isResizingRef.current) resizeFilmstrip(event.clientX + pointerOffsetRef.current);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        isResizingRef.current = false;
        pointerOffsetRef.current = 0;
      }}
      onPointerCancel={() => {
        isResizingRef.current = false;
        pointerOffsetRef.current = 0;
      }}
    />
  );
}

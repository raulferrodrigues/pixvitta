import { useRef, type HTMLAttributes, type ReactNode } from "react";
import { useAutoReveal } from "../../app/useAutoReveal";
import { classNames } from "../../ui/classNames";

// How far outside a zone the pointer can be and still reveal it.
const REVEAL_MARGIN_PX = 24;

type RevealZoneProps = HTMLAttributes<HTMLDivElement> & { autoHide: boolean; children: ReactNode };

// A floating group of controls. With autoHide it fades on its own, and each
// zone watches only its own area, so moving toward one corner doesn't reveal
// the others. Without it the zone stays visible.
export function RevealZone({ autoHide, className, children, ...props }: RevealZoneProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const isRevealed = useAutoReveal(autoHide, (x, y) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return false;
    return (
      x >= rect.left - REVEAL_MARGIN_PX &&
      x <= rect.right + REVEAL_MARGIN_PX &&
      y >= rect.top - REVEAL_MARGIN_PX &&
      y <= rect.bottom + REVEAL_MARGIN_PX
    );
  });
  return (
    <div ref={ref} className={classNames("immersive-zone", isRevealed && "is-revealed", className)} {...props}>
      {children}
    </div>
  );
}

import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../ui/classNames";

type ControlGroupProps = HTMLAttributes<HTMLDivElement> & { label: string; children: ReactNode };

export function ControlGroup({ label, className, children, ...props }: ControlGroupProps) {
  return <div className={classNames("inline-flex items-center gap-1.5 max-[420px]:gap-1", className)} role="group" aria-label={label} {...props}>{children}</div>;
}

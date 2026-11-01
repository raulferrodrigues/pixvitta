import type { ButtonHTMLAttributes } from "react";
import { classNames } from "./classNames";

type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role"> & {
  checked: boolean;
  onCheckedChange(checked: boolean): void;
};

export function Switch({ checked, onCheckedChange, className, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={classNames(
        "group relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pix-accent disabled:cursor-default disabled:opacity-45",
        checked ? "bg-pix-accent" : "bg-pix-control-border",
        className
      )}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    >
      <span
        aria-hidden
        className={classNames(
          "pointer-events-none block h-4 w-4 rounded-full shadow transition-transform",
          checked ? "translate-x-4 bg-pix-bg" : "translate-x-0.5 bg-pix-text"
        )}
      />
    </button>
  );
}

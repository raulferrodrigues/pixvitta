import type { ButtonHTMLAttributes, ReactNode } from "react";
import { classNames } from "./classNames";

type PrimaryButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

export function PrimaryButton({ className, children, ...props }: PrimaryButtonProps) {
  return (
    <button
      className={classNames(
        "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-pix-control-border bg-pix-panel px-4 font-semibold text-pix-text hover:bg-pix-panel-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pix-accent",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

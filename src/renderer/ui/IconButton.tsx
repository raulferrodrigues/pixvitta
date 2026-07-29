import * as Tooltip from "@radix-ui/react-tooltip";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { classNames } from "./classNames";
import "./tooltip.css";

type IconButtonVariant = "primary" | "secondary" | "prominent";

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  label: string;
  tooltip?: string;
  variant?: IconButtonVariant;
  children: ReactNode;
};

const variantClassNames: Record<IconButtonVariant, string> = {
  primary:
    "h-10 w-10 border-pix-control-border bg-pix-control text-pix-text max-[420px]:h-[38px] max-[420px]:w-[38px]",
  secondary:
    "h-[34px] w-[34px] border-pix-border bg-pix-control-muted text-pix-muted max-[420px]:h-8 max-[420px]:w-8",
  prominent:
    "h-10 w-10 border-pix-control-border bg-pix-control text-pix-text max-[420px]:h-[38px] max-[420px]:w-[38px]"
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      tooltip = label,
      variant = "secondary",
      className,
      children,
      ...props
    },
    ref
  ) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            ref={ref}
            className={classNames(
              "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border [font:inherit] disabled:cursor-default disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pix-accent",
              variantClassNames[variant],
              className
            )}
            aria-label={label}
            {...props}
          >
            {children}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="pix-tooltip"
            side="bottom"
            sideOffset={7}
            collisionPadding={8}
          >
            {tooltip}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  }
);

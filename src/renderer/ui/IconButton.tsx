import * as Tooltip from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactNode } from "react";
import { classNames } from "./classNames";
import "./tooltip.css";

type IconButtonVariant = "primary" | "secondary" | "prominent";

type IconButtonProps = Omit<ComponentProps<"button">, "title"> & {
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

export function IconButton({
  label,
  tooltip = label,
  variant = "secondary",
  className,
  children,
  ...props
}: IconButtonProps) {
  // A disabled button fires no pointer events, so the Radix tooltip never
  // opens on it. Keep the native title there so the label still shows.
  const button = (
    <button
      className={classNames(
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border [font:inherit] disabled:cursor-default disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pix-accent",
        variantClassNames[variant],
        className
      )}
      aria-label={label}
      title={props.disabled ? tooltip : undefined}
      {...props}
    >
      {children}
    </button>
  );
  if (props.disabled) return button;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="pix-tooltip" side="bottom" sideOffset={7} collisionPadding={8}>
          {tooltip}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

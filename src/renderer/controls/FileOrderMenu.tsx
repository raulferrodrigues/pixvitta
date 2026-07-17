import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowUpDown, Check } from "lucide-react";
import { useGT } from "gt-react";
import type { FileOrder } from "../../shared/settings";
import { FILE_ORDER_OPTIONS } from "../settings/fileOrderOptions";
import { IconButton } from "../ui/IconButton";

function isFileOrder(value: string): value is FileOrder {
  return FILE_ORDER_OPTIONS.some((option) => option.value === value);
}

export function FileOrderMenu({ value, onChange }: { value: FileOrder; onChange(value: FileOrder): void }) {
  const gt = useGT();
  const selectedOption = FILE_ORDER_OPTIONS.find((option) => option.value === value);
  const triggerLabel = gt("File order: {order}", { order: gt(selectedOption?.label ?? "Name") });
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton label={triggerLabel} className="viewer-file-order-trigger" data-testid="viewer-file-order-trigger"><ArrowUpDown size={17} aria-hidden /></IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="viewer-file-order-menu" align="start" side="bottom" sideOffset={-12} collisionPadding={8}>
          <DropdownMenu.Label className="viewer-file-order-label">{gt("File order")}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value} onValueChange={(nextValue) => { if (isFileOrder(nextValue)) onChange(nextValue); }}>
            {FILE_ORDER_OPTIONS.map((option) => (
              <DropdownMenu.RadioItem key={option.value} className="viewer-file-order-item" value={option.value} textValue={gt(option.label)}>
                <DropdownMenu.ItemIndicator className="viewer-file-order-indicator"><Check size={15} strokeWidth={2.4} aria-hidden /></DropdownMenu.ItemIndicator>
                {gt(option.label)}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

import { useGT } from "gt-react";

type CheckboxSettingRowProps = {
  testId: string;
  label: string;
  description: string;
  checked: boolean;
  onChange(checked: boolean): void;
};

export function CheckboxSettingRow({ testId, label, description, checked, onChange }: CheckboxSettingRowProps) {
  const gt = useGT();
  return (
    <label className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto] items-center gap-[18px] py-2">
      <span className="flex min-w-0 flex-col gap-[3px]">
        <strong className="text-sm">{gt(label)}</strong>
        <small className="text-xs text-pix-preferences-muted">{gt(description)}</small>
      </span>
      <input
        data-testid={testId}
        className="h-[18px] w-[18px] accent-pix-accent"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}

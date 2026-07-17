import { useGT } from "gt-react";

type SelectOption<Value extends string> = {
  value: Value;
  label: string;
};

type SelectSettingRowProps<Value extends string> = {
  testId: string;
  label: string;
  description: string;
  value: Value;
  options: ReadonlyArray<SelectOption<Value>>;
  onChange(value: Value): void;
};

function isOptionValue<Value extends string>(options: ReadonlyArray<SelectOption<Value>>, value: string): value is Value {
  return options.some((option) => option.value === value);
}

export function SelectSettingRow<Value extends string>({
  testId,
  label,
  description,
  value,
  options,
  onChange
}: SelectSettingRowProps<Value>) {
  const gt = useGT();
  return (
    <label className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto] items-center gap-[18px] py-2">
      <span className="flex min-w-0 flex-col gap-[3px]">
        <strong className="text-sm">{gt(label)}</strong>
        <small className="text-xs text-pix-preferences-muted">{gt(description)}</small>
      </span>
      <select
        data-testid={testId}
        className="min-h-9 w-52 max-w-full rounded-[7px] border border-pix-preferences-input-border bg-pix-control px-2.5 text-pix-preferences-text shadow-none [color-scheme:dark]"
        value={value}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          if (isOptionValue(options, nextValue)) onChange(nextValue);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {gt(option.label)}
          </option>
        ))}
      </select>
    </label>
  );
}

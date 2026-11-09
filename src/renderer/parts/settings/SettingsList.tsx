import { useGT } from "gt-react";
import type { ReactNode } from "react";
import type { AppSettings } from "../../../shared/settings";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { Switch } from "../../ui/Switch";
import { settingSections, type SelectSettingRow, type SettingRow } from "./settingsSections";
import { UpdateRow } from "./UpdateRow";

// Each row saves as soon as it changes. Rows only translate their labels; the
// store owns saving and rolls back a value whose save fails.
export function SettingsList() {
  const gt = useGT();
  return (
    <div className="grid content-start gap-6">
      {settingSections.map((section) => (
        <SettingsSection key={section.label} label={gt(section.label)}>
          {section.rows.map((row) => (
            <SettingRowControl key={row.testId} row={row} />
          ))}
        </SettingsSection>
      ))}
      <SettingsSection label={gt("Updates")}>
        <UpdateRow />
      </SettingsSection>
    </div>
  );
}

function SettingsSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="grid gap-2" aria-label={label}>
      <h3 className="m-0 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-pix-section">{label}</h3>
      <div className="rounded-xl border border-pix-border bg-pix-panel/40 [&>*+*]:border-t [&>*+*]:border-pix-border-subtle">
        {children}
      </div>
    </section>
  );
}

function SettingRowControl({ row }: { row: SettingRow }) {
  const gt = useGT();
  const settings = useViewerStore((state) => state.settings);
  const updateSettings = useViewerStore((state) => state.updateSettings);

  if (row.kind === "switch") {
    return (
      <RowLayout id={row.testId} label={gt(row.label)} description={gt(row.description)}>
        <Switch
          data-testid={row.testId}
          aria-labelledby={`${row.testId}-label`}
          aria-describedby={`${row.testId}-description`}
          checked={settings[row.setting]}
          onCheckedChange={(checked) => void updateSettings({ [row.setting]: checked })}
        />
      </RowLayout>
    );
  }

  return (
    <RowLayout id={row.testId} label={gt(row.label)} description={gt(row.description)}>
      <SettingSelect row={row} value={settings[row.setting]} onChange={(changes) => void updateSettings(changes)} />
    </RowLayout>
  );
}

function SettingSelect({
  row,
  value,
  onChange
}: {
  row: SelectSettingRow;
  value: string;
  onChange(changes: Partial<AppSettings>): void;
}) {
  const gt = useGT();
  return (
    <select
      data-testid={row.testId}
      aria-labelledby={`${row.testId}-label`}
      aria-describedby={`${row.testId}-description`}
      className="settings-select min-h-8 w-48 max-w-full cursor-pointer appearance-none rounded-lg border border-pix-control-border bg-pix-control pl-2.5 pr-8 text-sm text-pix-text shadow-none outline-none transition-colors [color-scheme:dark] hover:border-pix-tile-border-hover focus-visible:border-pix-accent"
      value={value}
      onChange={(event) => {
        const option = row.options.find((candidate) => candidate.value === event.currentTarget.value);
        if (option) onChange({ [row.setting]: option.value });
      }}
    >
      {row.options.map((option) => (
        <option key={option.value} value={option.value}>
          {gt(option.label)}
        </option>
      ))}
    </select>
  );
}

function RowLayout({ id, label, description, children }: { id: string; label: string; description: string; children: ReactNode }) {
  return (
    <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span id={`${id}-label`} className="text-sm font-medium text-pix-text">{label}</span>
        <span id={`${id}-description`} className="text-xs text-pix-muted">{description}</span>
      </div>
      {children}
    </div>
  );
}

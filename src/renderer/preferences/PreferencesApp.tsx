import { useEffect, useRef, useState } from "react";
import type { PixvittaApi } from "../../shared/pixvittaApi";
import { defaultSettings, type AppSettings } from "../../shared/settings";
import { CheckboxSettingRow } from "./CheckboxSettingRow";
import { PreferencesHeader, type PreferencesSaveState } from "./PreferencesHeader";
import { SelectSettingRow } from "./SelectSettingRow";
import { SettingGroup } from "./SettingGroup";
import { preferenceSections } from "./preferenceOptions";
import "./preferences.css";

type PreferencesAppProps = { api?: PixvittaApi };

export function PreferencesApp({ api = window.pixvitta }: PreferencesAppProps) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [saveState, setSaveState] = useState<PreferencesSaveState>("idle");
  const settingsRef = useRef(defaultSettings);
  const saveRevisionRef = useRef(0);

  function applySettingsState(nextSettings: AppSettings) {
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
  }

  useEffect(() => {
    let isMounted = true;
    void api.getSettings().then((loadedSettings) => {
      if (isMounted) applySettingsState(loadedSettings);
    });
    const unsubscribe = api.onSettingsChanged((nextSettings) => {
      applySettingsState(nextSettings);
      setSaveState("saved");
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [api]);

  async function updateSettings<Key extends keyof AppSettings>(setting: Key, value: AppSettings[Key]) {
    const nextSettings = { ...settingsRef.current, [setting]: value };
    const saveRevision = saveRevisionRef.current + 1;
    saveRevisionRef.current = saveRevision;
    applySettingsState(nextSettings);
    setSaveState("saving");
    try {
      const savedSettings = await api.saveSettings(nextSettings);
      if (saveRevision !== saveRevisionRef.current) return;
      applySettingsState(savedSettings);
      setSaveState("saved");
    } catch (error) {
      if (saveRevision !== saveRevisionRef.current) return;
      console.error(error);
      setSaveState("error");
    }
  }

  return (
    <main className="preferences-scrollbar h-screen overflow-y-auto bg-pix-preferences-bg px-6 pb-7 pt-6 text-pix-preferences-text [scrollbar-gutter:stable]" data-testid="preferences-shell">
      <PreferencesHeader saveState={saveState} />
      {preferenceSections.map((section) => (
        <SettingGroup key={section.label} label={section.label}>
          {section.rows.map((row) =>
            row.kind === "checkbox" ? (
              <CheckboxSettingRow
                key={row.testId}
                testId={row.testId}
                label={row.label}
                description={row.description}
                checked={settings[row.setting]}
                onChange={(value) => void updateSettings(row.setting, value)}
              />
            ) : (
              <SelectSettingRow
                key={row.testId}
                testId={row.testId}
                label={row.label}
                description={row.description}
                value={settings[row.setting]}
                options={row.options}
                onChange={(value) => void updateSettings(row.setting, value)}
              />
            )
          )}
        </SettingGroup>
      ))}
    </main>
  );
}

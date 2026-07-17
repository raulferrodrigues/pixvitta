import { useGT } from "gt-react";
import type { ReactNode } from "react";

export function SettingGroup({ label, children }: { label: string; children: ReactNode }) {
  const gt = useGT();
  return (
    <section className="border-t border-pix-preferences-border py-4" aria-label={gt(label)}>
      <h2 className="mb-2.5 mt-0 text-xs uppercase text-pix-preferences-heading">{gt(label)}</h2>
      {children}
    </section>
  );
}

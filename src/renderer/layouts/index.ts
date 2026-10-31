import type { ComponentType } from "react";
import type { ViewerLayout } from "../../shared/settings";
import { ClassicLayout } from "./classic/ClassicLayout";
import type { LayoutProps } from "./types";

// Each layout arranges the shared parts in its own way. Adding a layout means
// a new folder, a ViewerLayout value and an entry here.
export const layouts: Record<ViewerLayout, ComponentType<LayoutProps>> = {
  classic: ClassicLayout,
  immersive: ClassicLayout
};

import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import type { PixvittaApi } from "../../shared/pixvittaApi";
import { createViewerStore, type ViewerStore, type ViewerStoreApi } from "./viewerStore";

const ViewerStoreContext = createContext<ViewerStoreApi | null>(null);

type ViewerStoreProviderProps = {
  api: PixvittaApi;
  children: ReactNode;
};

export function ViewerStoreProvider({ api, children }: ViewerStoreProviderProps) {
  const storeRef = useRef<ViewerStoreApi | null>(null);
  if (!storeRef.current) {
    storeRef.current = createViewerStore(api);
  }

  return <ViewerStoreContext.Provider value={storeRef.current}>{children}</ViewerStoreContext.Provider>;
}

export function useViewerStore<T>(selector: (state: ViewerStore) => T): T {
  const store = useContext(ViewerStoreContext);
  if (!store) {
    throw new Error("useViewerStore must be used inside ViewerStoreProvider");
  }
  return useStore(store, selector);
}

export function useViewerStoreApi(): ViewerStoreApi {
  const store = useContext(ViewerStoreContext);
  if (!store) {
    throw new Error("useViewerStoreApi must be used inside ViewerStoreProvider");
  }
  return store;
}

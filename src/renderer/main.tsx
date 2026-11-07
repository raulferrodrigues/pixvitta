import React from "react";
import { createRoot } from "react-dom/client";
import * as Tooltip from "@radix-ui/react-tooltip";
import { initializeGTSPA } from "gt-react";
import gtConfig from "../../gt.config.json";
import { App } from "./App";
import loadTranslations from "./i18n/loadTranslations";
import { ViewerStoreProvider } from "./state/ViewerStoreProvider";
import "./styles/theme.css";
import "./styles/global.css";

async function renderApp() {
  // gt-react resolves the locale and loads its translations here, so every
  // useGT and <T> call below already has them on first render.
  const [buildInfo] = await Promise.all([
    window.pixvitta.getBuildInfo(),
    initializeGTSPA({ ...gtConfig, loadTranslations })
  ]);
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Tooltip.Provider delayDuration={500} skipDelayDuration={250}>
        <ViewerStoreProvider api={window.pixvitta}>
          <App buildInfo={buildInfo} />
        </ViewerStoreProvider>
      </Tooltip.Provider>
    </React.StrictMode>
  );
}

void renderApp();

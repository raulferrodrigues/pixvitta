import React from "react";
import { createRoot } from "react-dom/client";
import { GTProvider } from "gt-react";
import gtConfig from "../../gt.config.json";
import { App } from "./App";
import loadTranslations from "./i18n/loadTranslations";
import { PreferencesApp } from "./preferences/PreferencesApp";
import { ViewerStoreProvider } from "./state/ViewerStoreProvider";
import "./styles/theme.css";
import "./styles/global.css";

const isPreferences = window.location.hash === "#preferences";
const root = isPreferences ? (
  <PreferencesApp />
) : (
  <ViewerStoreProvider api={window.pixvitta}>
    <App />
  </ViewerStoreProvider>
);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GTProvider config={gtConfig} loadTranslations={loadTranslations}>{root}</GTProvider>
  </React.StrictMode>
);

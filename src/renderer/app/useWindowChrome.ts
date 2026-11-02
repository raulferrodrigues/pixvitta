import { useEffect } from "react";
import type { PixvittaApi, WindowChromeState } from "../../shared/pixvittaApi";

const MAC_TRAFFIC_LIGHT_SPACE_PX = 84;
const EDGE_INSET_PX = 10;

function applyLeadingSpace({ zoomFactor, isFullScreen, hasMacTrafficLights }: WindowChromeState) {
  const safeZoomFactor = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const leadingSpace = !hasMacTrafficLights || isFullScreen ? EDGE_INSET_PX : MAC_TRAFFIC_LIGHT_SPACE_PX / safeZoomFactor;
  document.documentElement.style.setProperty("--pix-topbar-leading-space", `${leadingSpace}px`);
}

export function useWindowChrome(api: PixvittaApi) {
  useEffect(() => {
    applyLeadingSpace({ zoomFactor: 1, isFullScreen: false, hasMacTrafficLights: false });
    void api.getWindowChromeState().then(applyLeadingSpace);
    return api.onWindowChromeChanged(applyLeadingSpace);
  }, [api]);
}

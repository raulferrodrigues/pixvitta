import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { MAX_IMAGE_ZOOM, MIN_IMAGE_ZOOM, roundImageTransformValue } from "../state/imageView";
import { useViewerStore } from "../state/ViewerStoreProvider";
import { imageTransformStyle } from "./imageZoom";

const WHEEL_LINE_PIXELS = 16;
const WHEEL_SCALE_DELTA_LIMIT = 24;
const WHEEL_SCALE_SPEEDUP = 2.4;

type ImageGeometry = {
  baseWidth: number;
  baseHeight: number;
  stageWidth: number;
  stageHeight: number;
  centerX: number;
  centerY: number;
};

type ImagePanGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
};

type ImageStageInteractionProps = {
  onWheel(event: ReactWheelEvent<HTMLElement>): void;
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(event: ReactPointerEvent<HTMLElement>): void;
};

export type ImageZoomInteractions = {
  imageRef: RefObject<HTMLImageElement | null>;
  imageStyle: CSSProperties;
  isImageZoomed: boolean;
  isImagePanning: boolean;
  stageInteractionProps: ImageStageInteractionProps;
};

function clampImagePan(panX: number, panY: number, zoom: number, geometry: ImageGeometry) {
  if (zoom <= MIN_IMAGE_ZOOM) return { panX: 0, panY: 0 };
  const maxPanX = Math.max(0, (geometry.baseWidth * zoom - geometry.stageWidth) / 2);
  const maxPanY = Math.max(0, (geometry.baseHeight * zoom - geometry.stageHeight) / 2);
  return {
    panX: roundImageTransformValue(Math.min(maxPanX, Math.max(-maxPanX, panX))),
    panY: roundImageTransformValue(Math.min(maxPanY, Math.max(-maxPanY, panY)))
  };
}

function normalizeWheelEvent(event: ReactWheelEvent<HTMLElement>) {
  let deltaX = event.deltaX;
  let deltaY = event.deltaY;
  if (deltaX === 0 && event.shiftKey) [deltaX, deltaY] = [deltaY, deltaX];
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    deltaX *= WHEEL_LINE_PIXELS;
    deltaY *= WHEEL_LINE_PIXELS;
  } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    deltaX *= window.innerWidth;
    deltaY *= window.innerHeight;
  }
  return { deltaX, deltaY };
}

function clampWheelScaleDelta(delta: number): number {
  return Math.sign(delta) * Math.min(WHEEL_SCALE_DELTA_LIMIT, Math.abs(delta));
}

function getWheelScaleMultiplier(delta: number): number {
  const scaledDelta = Math.abs(delta) * WHEEL_SCALE_SPEEDUP;
  if (scaledDelta === 0) return 1;
  return delta < 0 ? 1 + scaledDelta / 100 : 1 / (1 + scaledDelta / 100);
}

function getWheelZoomDelta(event: ReactWheelEvent<HTMLElement>): number {
  if (event.deltaZ !== 0) return clampWheelScaleDelta(event.deltaZ);
  return clampWheelScaleDelta(normalizeWheelEvent(event).deltaY);
}

function getPinchPanDelta(event: ReactWheelEvent<HTMLElement>) {
  const { deltaX, deltaY } = normalizeWheelEvent(event);
  return { x: deltaX, y: event.deltaZ !== 0 ? deltaY : 0 };
}

export function useImageZoomInteractions(enabled: boolean): ImageZoomInteractions {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const panGestureRef = useRef<ImagePanGesture | null>(null);
  const [isImagePanning, setIsImagePanning] = useState(false);
  const imageZoom = useViewerStore((state) => state.imageZoom);
  const imagePanX = useViewerStore((state) => state.imagePanX);
  const imagePanY = useViewerStore((state) => state.imagePanY);
  const zoomCurrentImage = useViewerStore((state) => state.zoomCurrentImage);
  const setImageView = useViewerStore((state) => state.setImageView);

  useEffect(() => {
    if (enabled) return;
    panGestureRef.current = null;
    setIsImagePanning(false);
  }, [enabled]);

  function getImageGeometry(stage: HTMLElement): ImageGeometry | null {
    const image = imageRef.current;
    if (!image || imageZoom <= 0) return null;
    const imageRect = image.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const baseWidth = imageRect.width / imageZoom;
    const baseHeight = imageRect.height / imageZoom;
    if (baseWidth <= 0 || baseHeight <= 0 || stageRect.width <= 0 || stageRect.height <= 0) return null;
    return {
      baseWidth,
      baseHeight,
      stageWidth: stageRect.width,
      stageHeight: stageRect.height,
      centerX: imageRect.left + imageRect.width / 2 - imagePanX,
      centerY: imageRect.top + imageRect.height / 2 - imagePanY
    };
  }

  function handleWheel(event: ReactWheelEvent<HTMLElement>) {
    if (!enabled) return;
    if (event.ctrlKey) {
      event.preventDefault();
      const zoomDelta = getWheelZoomDelta(event);
      const panDelta = getPinchPanDelta(event);
      if (zoomDelta === 0 && panDelta.x === 0 && panDelta.y === 0) return;
      const geometry = getImageGeometry(event.currentTarget);
      if (!geometry) {
        if (zoomDelta !== 0) {
          const nextZoom = roundImageTransformValue(Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, imageZoom * getWheelScaleMultiplier(zoomDelta))));
          zoomCurrentImage(nextZoom / imageZoom);
        }
        return;
      }
      const nextZoom = zoomDelta === 0
        ? imageZoom
        : roundImageTransformValue(Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, imageZoom * getWheelScaleMultiplier(zoomDelta))));
      const zoomRatio = imageZoom <= 0 ? 1 : nextZoom / imageZoom;
      const pointerOffsetX = zoomDelta === 0 ? 0 : event.clientX - geometry.centerX;
      const pointerOffsetY = zoomDelta === 0 ? 0 : event.clientY - geometry.centerY;
      const nextPan = clampImagePan(
        imagePanX * zoomRatio + pointerOffsetX * (1 - zoomRatio) - panDelta.x,
        imagePanY * zoomRatio + pointerOffsetY * (1 - zoomRatio) - panDelta.y,
        nextZoom,
        geometry
      );
      setImageView(nextZoom, nextPan.panX, nextPan.panY);
      return;
    }
    if (imageZoom <= MIN_IMAGE_ZOOM || (event.deltaX === 0 && event.deltaY === 0)) return;
    const geometry = getImageGeometry(event.currentTarget);
    if (!geometry) return;
    event.preventDefault();
    const { deltaX, deltaY } = normalizeWheelEvent(event);
    const nextPan = clampImagePan(imagePanX - deltaX, imagePanY - deltaY, imageZoom, geometry);
    setImageView(imageZoom, nextPan.panX, nextPan.panY);
  }

  function startImagePan(event: ReactPointerEvent<HTMLElement>) {
    if (!enabled || event.button !== 0 || imageZoom <= MIN_IMAGE_ZOOM || !getImageGeometry(event.currentTarget)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panGestureRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startPanX: imagePanX, startPanY: imagePanY };
    setIsImagePanning(true);
  }

  function moveImagePan(event: ReactPointerEvent<HTMLElement>) {
    const gesture = panGestureRef.current;
    if (!enabled || !gesture || gesture.pointerId !== event.pointerId) return;
    const geometry = getImageGeometry(event.currentTarget);
    if (!geometry) return;
    event.preventDefault();
    const nextPan = clampImagePan(gesture.startPanX + event.clientX - gesture.startX, gesture.startPanY + event.clientY - gesture.startY, imageZoom, geometry);
    setImageView(imageZoom, nextPan.panX, nextPan.panY);
  }

  function finishImagePan(event: ReactPointerEvent<HTMLElement>) {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    panGestureRef.current = null;
    setIsImagePanning(false);
  }

  return {
    imageRef,
    imageStyle: { transform: imageTransformStyle(imageZoom, imagePanX, imagePanY) },
    isImageZoomed: enabled && imageZoom > MIN_IMAGE_ZOOM,
    isImagePanning,
    stageInteractionProps: {
      onWheel: handleWheel,
      onPointerDown: startImagePan,
      onPointerMove: moveImagePan,
      onPointerUp: finishImagePan,
      onPointerCancel: finishImagePan
    }
  };
}

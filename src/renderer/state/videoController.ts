export type VideoController = {
  attach(element: HTMLVideoElement | null): void;
  togglePlayback(): Promise<void>;
  seekBy(seconds: number): boolean;
};

export function createVideoController(): VideoController {
  let element: HTMLVideoElement | null = null;

  return {
    attach(nextElement) {
      element = nextElement;
    },

    async togglePlayback() {
      if (!element) return;
      if (!element.paused) {
        element.pause();
        return;
      }

      const duration = Number.isFinite(element.duration) ? element.duration : undefined;
      if (element.ended || (duration !== undefined && duration > 0 && element.currentTime >= duration)) {
        element.currentTime = 0;
      }
      await element.play();
    },

    seekBy(seconds) {
      if (!element || !Number.isFinite(seconds)) return false;
      const currentTime = Number.isFinite(element.currentTime) ? element.currentTime : 0;
      const duration = Number.isFinite(element.duration) ? element.duration : undefined;
      const targetTime = Math.max(0, currentTime + seconds);
      element.currentTime = duration === undefined ? targetTime : Math.min(duration, targetTime);
      return true;
    }
  };
}

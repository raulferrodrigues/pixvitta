export type GalleryAccess = {
  accountId: string;
  generation: number;
  assertCurrent(): void;
  fetch(request: Request): Promise<Response>;
};

export class GalleryAccessExpiredError extends Error {
  constructor() {
    super("The gallery belongs to an earlier sign-in session.");
    this.name = "GalleryAccessExpiredError";
  }
}

// A lease guards requests when the broker starts them, rather than only when
// they are queued. Invalidation also prevents old galleries serving cache hits.
export class GalleryAuthentication {
  private generation = 0;

  invalidate(): void {
    this.generation += 1;
  }

  capture(
    accountId: string,
    fetch: (request: Request) => Promise<Response>
  ): GalleryAccess {
    const generation = this.generation;
    const assertCurrent = () => {
      if (generation !== this.generation) throw new GalleryAccessExpiredError();
    };
    return {
      accountId,
      generation,
      assertCurrent,
      async fetch(request) {
        assertCurrent();
        const response = await fetch(request);
        try {
          assertCurrent();
        } catch (error) {
          await response.body?.cancel().catch(() => {});
          throw error;
        }
        return response;
      }
    };
  }
}

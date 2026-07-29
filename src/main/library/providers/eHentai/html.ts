import { parse } from "parse5";

type HtmlAttribute = {
  name: string;
  value: string;
};

type HtmlNode = {
  nodeName?: string;
  attrs?: HtmlAttribute[];
  childNodes?: HtmlNode[];
};

function attribute(node: HtmlNode, name: string): string | null {
  return node.attrs?.find((item) => item.name === name)?.value ?? null;
}

function findElement(
  node: HtmlNode,
  predicate: (candidate: HtmlNode) => boolean
): HtmlNode | null {
  if (predicate(node)) return node;
  for (const child of node.childNodes ?? []) {
    const result = findElement(child, predicate);
    if (result) return result;
  }
  return null;
}

export type EHentaiImagePageReference = {
  pageNumber: number;
  pageUrl: string;
  pageToken: string;
  thumbnail: EHentaiThumbnailReference | null;
};

export type EHentaiThumbnailReference =
  | {
      kind: "direct";
      url: string;
    }
  | {
      kind: "sprite";
      url: string;
      crop: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    };

function pixelValue(style: string, property: string): number | null {
  const match = style.match(
    new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(\\d+)px(?:;|$)`, "i")
  );
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function thumbnailFrom(anchor: HtmlNode): EHentaiThumbnailReference | null {
  const thumbnail = findElement(anchor, (node) => {
    const style = attribute(node, "style");
    return !!style && /url\(/i.test(style);
  });
  const style = thumbnail ? attribute(thumbnail, "style") : null;
  const match = style?.match(/url\(\s*["']?(https:[^)"'\s]+)["']?\s*\)/i);
  if (!match) return null;

  try {
    const url = new URL(match[1]);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    if (url.hostname === "ehgt.org") {
      return { kind: "direct", url: url.href };
    }
    if (!url.hostname.endsWith(".hath.network") || !style) return null;

    const width = pixelValue(style, "width");
    const height = pixelValue(style, "height");
    const position = style.match(
      /url\([^)]*\)\s*(-?\d+)(?:px)?\s+(-?\d+)(?:px)?\s+no-repeat/i
    );
    if (!width || !height || !position) return null;
    const positionX = Number(position[1]);
    const positionY = Number(position[2]);
    if (
      !Number.isSafeInteger(positionX) ||
      !Number.isSafeInteger(positionY) ||
      positionX > 0 ||
      positionY > 0
    ) {
      return null;
    }
    return {
      kind: "sprite",
      url: url.href,
      crop: {
        x: -positionX,
        y: -positionY,
        width,
        height
      }
    };
  } catch {
    return null;
  }
}

export function parseGalleryImagePages(
  html: string,
  galleryUrl: string,
  galleryId: string
): Map<number, EHentaiImagePageReference> {
  const references = new Map<number, EHentaiImagePageReference>();
  const document = parse(html) as unknown as HtmlNode;

  function visit(node: HtmlNode): void {
    if (node.nodeName === "a") {
      const href = attribute(node, "href");
      if (href) {
        try {
          const url = new URL(href, galleryUrl);
          const match = url.pathname.match(
            new RegExp(`^/s/([a-f0-9]+)/${galleryId}-([1-9]\\d*)/?$`, "i")
          );
          if (
            url.origin === "https://e-hentai.org" &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            match
          ) {
            const pageNumber = Number(match[2]);
            if (Number.isSafeInteger(pageNumber)) {
              references.set(pageNumber, {
                pageNumber,
                pageUrl: url.href.replace(/\/$/, ""),
                pageToken: match[1].toLowerCase(),
                thumbnail: thumbnailFrom(node)
              });
            }
          }
        } catch {
          // Ignore malformed links and continue looking for valid page entries.
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  }

  visit(document);
  return references;
}

export function parseDisplayedImageUrl(
  html: string,
  imagePageUrl: string
): string | null {
  const document = parse(html) as unknown as HtmlNode;
  const image = findElement(
    document,
    (node) => node.nodeName === "img" && attribute(node, "id") === "img"
  );
  const source = image ? attribute(image, "src") : null;
  if (!source) return null;

  try {
    return new URL(source, imagePageUrl).href;
  } catch {
    return null;
  }
}

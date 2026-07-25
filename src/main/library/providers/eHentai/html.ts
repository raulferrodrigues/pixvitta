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
};

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
                pageToken: match[1].toLowerCase()
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

export function parseFirstImagePageUrl(
  html: string,
  galleryUrl: string,
  galleryId: string
): { pageUrl: string; pageToken: string } | null {
  const first = parseGalleryImagePages(html, galleryUrl, galleryId).get(1);
  return first
    ? {
        pageUrl: first.pageUrl,
        pageToken: first.pageToken
      }
    : null;
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

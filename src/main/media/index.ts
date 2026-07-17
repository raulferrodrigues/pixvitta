/*
 * Public media surface.
 *
 * Media owns scanning, path registration, custom media URLs, and native media
 * context menus. Outside modules only need to open a folder or open a file as
 * its containing folder.
 */
export { openMediaFile, openMediaFolder } from "./mediaFeature";

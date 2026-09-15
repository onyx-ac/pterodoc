/**
 * The site model: what a source produces and what the reconciler consumes.
 *
 * This layer knows nothing about where a model came from or where it is going.
 */

export type {
  Doc,
  DocAuthor,
  DocNeighbour,
  DocsInstance,
  DocsVersion,
  NavbarItem,
  SiteNavbar,
  SidebarCategoryItem,
  SidebarCategoryLink,
  SidebarDocItem,
  SidebarHtmlItem,
  SidebarItem,
  SidebarLinkItem,
  SiteModel,
} from './types';
export { buildPageTree } from './tree';
export type { BuildPageTreeInput, PageKind, PageNode, PageTree } from './tree';
export { createMemoryReader } from './reader';
export type { SourceReader } from './reader';
export { createCaptureReader, readCapture, serializeModel, writeCapture } from './capture';
export type { CapturedModel } from './capture';

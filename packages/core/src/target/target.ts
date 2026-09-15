/**
 * What a publishing target has to be able to do.
 *
 * WordPress is the only implementation today, but keeping the contract
 * explicit is what stops target vocabulary leaking into the renderer and the
 * reconciler.
 */

/** What a target can and cannot do. */
export interface TargetCapabilities {
  /** Page ids must exist before bodies can be rendered, as WordPress's page list needs. */
  needsIdsBeforeRender: boolean;
  /** Files can be uploaded and referenced. */
  supportsMedia: boolean;
  /** Pages with no source can be removed. */
  supportsPrune: boolean;
  /**
   * The tree's own root is published as a page.
   *
   * False where the target gives the tree a namespace of its own -- a custom
   * post type, whose archive is the index -- so there is nothing at the root
   * for pterodocs to write, and everything it does write hangs from the
   * collection rather than from a page.
   */
  publishesTreeRoot: boolean;
  /** Pages nest; a flat target gets its whole path as one name. */
  supportsHierarchy: boolean;
  /** There is a separate summary field. */
  supportsExcerpt: boolean;
  /** Arbitrary key/value metadata can be written. */
  supportsMeta: boolean;
  /** A page can be given a template. */
  supportsTemplates: boolean;
  /** A page can be created unpublished. */
  supportsDrafts: boolean;
}

/**
 * Metadata key marking a page as one pterodocs wrote.
 *
 * Ownership is normally read off the page's own markup, which works because a
 * documentation page always carries the generated layout. A page published
 * with no navigation and no breadcrumb carries no generated class at all --
 * and then prune and purge stop recognising it, which is the failure that
 * leaves published pages nobody can clean up. Targets that can store metadata
 * write this instead; the markup test remains the fallback.
 */
export const OWNERSHIP_META = '_pterodocs_source';

/** The value that key carries. */
export const OWNERSHIP_VALUE = 'pterodocs';

/** A page as it exists on the target. */
export interface RemotePage {
  id: number;
  parent: number;
  slug: string;
  status: string;
  link: string;
  title: string;
  content?: string;
  excerpt?: string;
  menuOrder: number;
  template: string;
  meta?: Record<string, unknown> | undefined;
  /** When the target believes it was published, as an ISO instant in UTC. */
  date?: string | undefined;
  /** Taxonomy term ids, when the target holds any for this page. */
  tags?: number[] | undefined;
}

/** A page as pterodocs would publish it. */
export interface RenderedPage {
  /** Path within the published tree. */
  path: string;
  /** Slug of the last path segment. */
  slug: string;
  /** Page title. */
  title: string;
  /** The composed body. */
  content: string;
  /** Short summary. */
  excerpt: string;
  /** Position among siblings. */
  menuOrder: number;
  /** Metadata to write, when the target supports it. */
  meta: Record<string, string>;
  /**
   * When this document was published, ISO 8601.
   *
   * A blog post has one and documentation does not, which is why everything
   * that reads it is guarded: a page with no date must never diff on one.
   */
  date?: string | undefined;
  /**
   * Tags, as the document writes them.
   *
   * Labels, not ids: what a term is called numerically is the target's own
   * business, and the renderer has no way to know it.
   */
  tags?: string[] | undefined;
  /** Source file, for messages. */
  file?: string | undefined;
  /** Version this page belongs to. */
  versionName?: string | undefined;
}

/** A file to upload. */
export interface MediaUpload {
  bytes: Uint8Array;
  filename: string;
  hash: string;
  mime: string;
  alt: string;
  title: string;
}

/** An uploaded file. */
export interface MediaRef {
  id: number;
  hash: string;
  url: string;
  filename: string;
  mime: string;
}

/** Asking the target to make sure a page exists. */
export interface EnsureRequest {
  path: string;
  slug: string;
  parentId: number | null;
  title: string;
  menuOrder: number;
  isRoot: boolean;
}

/** What came of that. */
export interface EnsureResult {
  id: number | null;
  created: boolean;
  warnings: string[];
}

/** An open connection to a target. */
export interface TargetSession {
  /** Every page under the target's namespace, fetched once. */
  loadIndex(): Promise<RemotePage[]>;
  /**
   * Make sure everything above the documentation root exists.
   *
   * The target owns this because only it knows what a path is made of. Pages
   * it has to create are reported so the plan can show them; pages that were
   * already there are never touched.
   */
  ensureRootParent(): Promise<{ id: number | null; created: { path: string; id: number | null }[] }>;
  /** Make sure a page exists at this position, and give back its id. */
  ensurePage(request: EnsureRequest): Promise<EnsureResult>;
  /** Fetch a page with the fields needed to compare it. */
  fetchPage(id: number): Promise<RemotePage>;
  /** Which fields of an existing page differ from the rendered one. */
  diffPage(remote: RemotePage, rendered: RenderedPage, parentId: number): string[];
  /** Write a rendered page, returning warnings for anything the target refused. */
  writePage(id: number, page: RenderedPage, parentId: number): Promise<{ warnings: string[] }>;
  /**
   * Write metadata on its own, without touching the page it belongs to.
   *
   * Needed for anything derived from the whole tree rather than from one
   * document — `llms.txt` is the only such thing today. It cannot travel with
   * the page write, because the page is written while the tree is still being
   * rendered and the value is not known until every page is done.
   *
   * Returns warnings rather than throwing when the target refuses: metadata is
   * never worth failing a publish over.
   */
  writeMeta(id: number, meta: Record<string, string>): Promise<{ warnings: string[] }>;
  /**
   * Check that a page's own URL actually serves that page.
   *
   * Publishing a page is not the same as being able to reach it. A site can
   * carry rules that claim a path before the page ever gets a look in — a
   * rewrite endpoint registered by some other plugin is the usual way — and
   * the symptom is silent: the URL answers 200 with somebody else's content,
   * so nothing in the publish reports a problem.
   *
   * Answers `unknown` rather than guessing when the page it served cannot be
   * identified, because a warning nobody can act on is worse than none.
   */
  verifyResolution(
    id: number,
    url: string,
  ): Promise<{ verdict: 'ok' | 'shadowed' | 'unknown'; servedId?: number | undefined }>;
  /** Pages below a root that no rendered page accounts for, deepest first. */
  computePrune(index: RemotePage[], rootId: number, keepIds: Set<number>): RemotePage[];
  /** Remove a page. Never a permanent delete. */
  removePage(page: RemotePage): Promise<void>;
  /** Files already uploaded, by content hash. */
  loadMediaIndex(): Promise<Map<string, MediaRef>>;
  /** Upload one file. */
  uploadMedia(upload: MediaUpload): Promise<MediaRef>;
  /** How many requests this session has made. */
  requestCount(): number;
}

/** A place documentation can be published. */
export interface Target {
  /** Name used in messages and in the plan. */
  readonly name: string;
  /** What this target can do. */
  readonly capabilities: TargetCapabilities;
  /** Absolute site path for a tree path: the target owns URL policy. */
  hrefFor(treePath: string, context: { versionName: string; locale: string }): string;
  /** The path pages are published under, for messages. */
  readonly rootPath: string;
  /** Open a session. */
  open(context: { locale: string; dryRun: boolean }): Promise<TargetSession>;
}

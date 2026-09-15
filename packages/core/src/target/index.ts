/**
 * The target contract: what a place pages are published to must provide.
 *
 * Implementations live beside this, or in their own package; the reconciler
 * only ever sees what is declared here.
 */

export { OWNERSHIP_META, OWNERSHIP_VALUE } from './target';
export type {
  EnsureRequest,
  EnsureResult,
  MediaRef,
  MediaUpload,
  RemotePage,
  RenderedPage,
  Target,
  TargetCapabilities,
  TargetSession,
} from './target';

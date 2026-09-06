// ============================================================================
// LUXEDGE — BACKGROUND AUTO-SEO JOB STORE (Blog)
//
// The bulk "Auto SEO All" run on the Blog manager lives in a module-level
// store so it survives SPA navigation AND full page reloads (checkpoint +
// resume offer), exactly like the Products run. The engine is shared — see
// `features/ai/backgroundJobStore.ts` — and this module is the Blog instance,
// keyed so its progress and resume offer never collide with the Products run.
// ============================================================================
import { createBackgroundJobStore } from '../ai/backgroundJobStore';
import type { CmsBlogRow } from '../../services/blog';

/** Blog Auto-SEO instance — its own queue + its own localStorage checkpoint. */
export const useBlogJobStore = createBackgroundJobStore<CmsBlogRow>('luxedge.blogSeoJob.v1');

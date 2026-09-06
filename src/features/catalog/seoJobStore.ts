// ============================================================================
// LUXEDGE — BACKGROUND AUTO-SEO JOB STORE (Products)
//
// The bulk Auto-SEO run on the Products page lives in a module-level store so
// it survives SPA navigation AND full page reloads (checkpoint + resume offer).
// The engine is shared with the Blog manager — see
// `features/ai/backgroundJobStore.ts`; this module is the Products instance,
// keyed so its progress and resume offer never collide with the Blog run's.
// ============================================================================
import { createBackgroundJobStore } from '../ai/backgroundJobStore';
import type { CatalogProduct } from './types';

export type { SeoStatus, SeoJobReport, SeoJobCheckpoint } from '../ai/backgroundJobStore';
export type StartSeoJobOptions = import('../ai/backgroundJobStore').BackgroundJobOptions<CatalogProduct>;

/** Products Auto-SEO instance — its own queue + its own localStorage checkpoint. */
export const useSeoJobStore = createBackgroundJobStore<CatalogProduct>('luxedge.seoJob.v1');

// ============================================================================
// LUXEDGE V2 — SHARED DOMAIN TYPES
//
// Home for types shared across features. The storefront (App.tsx) still keeps
// its own inline commerce shapes for now; as the data layer (src/services/db)
// matures in later phases, domain entities migrate here.
//
// SECURITY NOTE: no credential types belong here. Secrets are server-side.
// ============================================================================

export type UserRole = 'admin' | 'buyer';

export interface User {
  id: string;
  email: string;
  password: string; // demo auth — must move to hashed server-side auth (Phase 2+)
  name: string;
  role: UserRole;
  avatar?: string;
  phone?: string;
  address?: string;
  createdAt: string;
  lastLogin?: string;
  isBlocked: boolean;
}

// ============================================================================
// LUXEDGE V2 — SHARED DOMAIN TYPES
//
// Home for types shared across features. The storefront (App.tsx) still keeps
// its own inline commerce shapes for now; as the data layer (src/services/db)
// matures in later phases, domain entities migrate here.
//
// SECURITY NOTE: no credential types belong here. Secrets are server-side.
// Passwords are verified by Supabase Auth and are never stored client-side.
// ============================================================================

export type UserRole = 'admin' | 'buyer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  password?: string; // legacy demo field — Supabase Auth owns real credentials
  avatar?: string;
  phone?: string;
  address?: string;
  createdAt: string;
  lastLogin?: string;
  isBlocked: boolean;
}

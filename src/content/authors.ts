/**
 * LUXEDGE — AUTHOR REGISTRY (single source for /author/<slug>)
 *
 * EMPTY ON PURPOSE. No real author identity has been supplied: not a name we
 * can print, not a photograph we are allowed to use, not a bio anyone has
 * written. Until that arrives, /author/<unknown-slug> is a 404 — which is the
 * honest answer, because an author page that invents a person is exactly the
 * fabricated-credibility pattern an ad reviewer is looking for.
 *
 * TO PUBLISH AN AUTHOR: add one entry below. Both render paths read this list —
 * the worker pre-renders the same name/bio/photo into the server HTML, and the
 * React page renders it after hydration — so a profile can never half-exist.
 * Articles are associated by matching the CMS `author_name` on a post, so
 * publishing an author is enough for their byline to link here.
 *
 * Do not add a placeholder person, a stock face, or a bio with credentials
 * nobody holds. The byline used across the blog today is the honest
 * "Luxedge Editorial Team", which is a team attribution, not a person.
 */

export interface AuthorProfile {
  /** URL segment: /author/<slug>. */
  slug: string;
  /** The name printed in the byline and on the page. */
  name: string;
  /** A real photo, absolute URL or site-relative path. Omitted when none exists. */
  photo?: string;
  /** Short editorial bio: who they are and what they actually know about. */
  bio: string;
  /** Verified external profiles for this person only (no placeholders). */
  links?: { label: string; href: string }[];
}

export const AUTHORS: AuthorProfile[] = [];

/** The profile for a slug, or undefined when nobody by that name is published. */
export function authorFor(slug: string): AuthorProfile | undefined {
  return AUTHORS.find((a) => a.slug === slug);
}

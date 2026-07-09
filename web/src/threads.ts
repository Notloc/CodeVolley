import type { Thread } from "./types.js";

// UI-only convention (nothing persisted): praise threads are plain comments —
// no resolution lifecycle, so no status pill, no resolve/won't-fix/fix-it
// controls, and they don't count as open work in tabs or tree badges.
// Replies and the awaiting/thinking indicators still apply. If this ever
// needs to be per-thread rather than per-severity, promote it to a real
// flag on the thread schema.
export function isResolvable(t: Thread): boolean {
  return t.severity !== "praise";
}

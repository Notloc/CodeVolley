# Side-by-side (split) diff view — design notes

Status: **deferred.** The diff currently renders as a **unified** single-column
view ([web/src/diffRows.ts](../web/src/diffRows.ts) `buildUnifiedRows`,
[web/src/components/DiffFile.tsx](../web/src/components/DiffFile.tsx)). This note
records why we backed off the split view and how to bring it back cleanly.

## Why we dropped the split view for now

We wanted **one horizontal scrollbar per side** (all old lines share a scroll,
all new lines share a scroll) instead of a scrollbar on every line.

That fights the old grid layout. Per-side scroll needs the cells to be
**column-major** — every old-side cell in one horizontal scroll container, every
new-side cell in another. But inline comment threads are **row-major** — a
thread sits between two code lines and, in the old design, spanned the full
width so it pushed *both* sides down together. You can't have both cheaply:
making them coexist needs duplicated/spacer thread rows or JS to sync scroll
positions across segments. So we shipped unified instead (one text column → one
natural scrollbar, no tension).

## The Bitbucket model (how to bring split view back)

Bitbucket resolves the tension by **anchoring every comment to exactly one
side** rather than spanning both:

- **Additions** anchor to the **right** (new) side.
- **Removals and unchanged / existing lines** anchor to the **left** (old) side.

Because a comment belongs to a single column, its thread lives *inside that
side's pane* — it no longer has to span both panes, so it doesn't force the two
sides to stay row-aligned. Each side can then be its own independent horizontal
scroll container (per-side scrollbar) with the thread rows flowing inside it.
The two panes only need to agree on the vertical position of the *code* rows;
the taller side (the one holding an open thread) simply grows, and a spacer on
the opposite side keeps the following code lines aligned.

### Implementation sketch when we revive it

- Two panes side by side, each `overflow-x: auto` → the per-side scrollbar.
- Comment placement rule mirrors Bitbucket: `side === "NEW"` threads render in
  the right pane; `side === "OLD"` (removals) and unchanged-line threads render
  in the left pane.
- Keep code rows aligned across panes: when one side opens a thread, insert an
  equal-height spacer on the other side so subsequent lines stay level.
- The daemon already stores an explicit `side` per thread anchor
  (`currentAnchor.side` is `"OLD" | "NEW"`), so no backend change is needed —
  this is purely a front-end layout/placement decision.

The unified view we shipped is a fine default; treat split view as a togglable
alternative, not a replacement.

# Spatial Architecture

Where things live and how depth works. The full build spec is
`../RECURSIVE_ORG_SPEC.md` (Rev 7 — the density gradient; Rev 8 — the desk).

## The zones (every screen, fixed)

masthead → rail → instrument → shelf. Only the instrument changes. One
dominant object per screen — a lens REPLACES the wheel, never stacks on it.

**Fixed is now enforced, not asserted (Rev 10).** The shell is `height: 100dvh`
+ `overflow: hidden`; the instrument flexes with `minHeight: 0`; the shelf is
pinned with `flexShrink: 0`. Before Rev 10 the root carried `minHeight: 100vh`,
which let the whole column grow and put the scroll on the document — the zones
were never actually fixed.

## The fit law (Rev 10)

> Density is bounded by the WINDOW, not by the content. A list renders what
> fits, states its true total, and sends the remainder one level deeper.
> Only the record itself may scroll.

Budget at the **700px floor** (1024×700, the supported minimum):

| Zone | Px | Owner |
|---|---|---|
| pulse + masthead | 55 | shell chrome |
| workspace padding | 32 | shell chrome |
| **instrument** | **~590** | the view — measured and published via `canvas/layout.ts` |
| shelf (when present) | ~90 | board + pins, pinned, never yields |

L0 spends its instrument on: rail (52) + caption (56) + hub row (48) = 164 of
chrome, leaving ~426 for the face → wheel scale ≈ 0.82.

Every clamped region derives its row count from `fitRows(availPx, rowPx)`. New
regions must do the same — a fresh `slice(0, N)` is a Quality Gate failure.

**The two named exceptions** (append-only records; clamping them would hide or
edit the record): the transcript (`.cv-thread`) and the unrolled verbatim
deliverable at L3 (`.cv-record`).

## The descent (org depth = detail depth)

| Level | You are | Density budget |
|---|---|---|
| L0 | the watch face | wheel · one caption (the objective) · whisper rail · hub sub-dials · one attention count (absent at zero). Nothing else, ever. |
| L1 | a desk or a lens | full masthead + ONE primary instrument (desk: hero + Working On + sidebar previews; Work lens: command line + review queue) |
| L2 | a stratum opened | counted lines become rows (folded ladder groups, strata, row expansion) |
| L3 | the record | verbatim output unrolled |

## The desk anatomy (Rev 8) — the constitution's page architecture, mapped

Identity → the masthead (medallion, title, kind pill, role copy, status strip)
Current Work → the hero + Working-On rows
People → the reporting structure tree (masthead right)
Memory → the Memory sidebar card
Artifacts → the Artifacts sidebar card

## Placement rules

- Conversation left (35%), workspace right. The composer owns capability
  suggestions; the scope chip names who you're asking.
- Ephemera rest LOW: the board and pins live on the shelf below the pane.
- Operational empties always render ("Idle right now", "Nothing queued");
  accumulated records are silent at zero and appear as counted strata.
- One address per fact per screen — a fact that appears twice is a bug.
- The Runtime tray is the ONE sanctioned overlay (Popover layer, read-only,
  transient) — the runtime made glanceable from any context. Nothing else
  may stack.

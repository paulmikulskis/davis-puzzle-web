# Maze Hunt — Phased Plan

Status: **post-Codex-review draft** · Author: planning agent fleet · Date: 2026-05-08
Reviews folded: Codex eagle-eyed pre-implementation review (5 critical, 5 important, 4 nice-to-have findings; all critical findings folded, see §7 contracts appendix).
Repo: `paulmikulskis/davis-puzzle-web` · Branch target: `main` · Production: <https://davis-puzzle-web.vercel.app>

This plan turns the second class of Davis Rioux's clinical deliverables — the
"Maze Hunt" worksheets distributed as `BPS Activity Sheets` (see
`/Users/paulmikulskis/Development/Davis-Puzzle/minecraft-maze-hunts.pdf`) — into
a coherent extension of the existing Davis Puzzle web app, while preserving the
Pixel Puzzle product unchanged.

It composes a foundational PDF analysis and eight per-feature research
artifacts into five sequenced epics. Each epic is small enough to ship in days,
not weeks, and each ends in a printable artifact Andrew can use with kids that
afternoon.

> Framing reminder for every reader of this plan: this is **a clinical tool,
> not a Minecraft game.** The Minecraft layer is a delivery medium chosen
> because it is socially engaging for the kids Andrew sees. The product surface
> must give Andrew clinical control over therapeutic targets — not let him (or
> us) drift into Minecraft level-editor territory. Every design decision in
> this plan was tested against that framing.

---

## 1. North star and clinical value

Andrew is a pediatric occupational therapist. He uses Minecraft-themed paper
worksheets in 1:1 and small-group sessions to train, in roughly this order of
clinical weight:

- **Fine motor** — pencil control along narrow corridors, scissors along
  black-bordered tiles, glue handling.
- **Graphomotor planning** — drawing a continuous unbroken pencil line as a
  precursor to handwriting precision.
- **Visual-spatial reasoning** — scanning a themed board for items, mapping a
  cut-out tile to a target slot, recognizing canonical Minecraft constructions
  (Wither summon T-shape, hopper feeding furnace, obsidian pillar with
  ladders).
- **Executive function** — multi-objective sequencing via the top-of-page
  checklist, monitoring of one's own progress, task initiation under time
  pressure.
- **Working memory** — holding 3–4 objectives in mind while executing them.
- **Cross-midline integration** — page layout deliberately spans the full
  letter sheet so the child must shift hands and eyes between the maze
  (left/center), the cutouts and the assembly target (right), and the
  checklist (top-left).

The **north star deliverable** is therefore: a worksheet Andrew can produce in
under 30 seconds, hand to a child, and trust to do real therapeutic work —
without him needing to think about layout, font choice, or what "Easy" means
for a circular maze.

The **product surface that gets us there** is an editor that *gives Andrew the
clinical knobs that matter (theme, difficulty, count, cut size) and hides the
ones that don't (wall placement, font selection, page geometry).* The single
hardest design problem in this whole plan is keeping the boundary between
those two sets honest. Section 2 captures the non-negotiables that hold that
line.

---

## 2. Non-negotiables and CLAUDE.md trade-offs

The existing app's `web/CLAUDE.md` enumerates a strict surface. This plan
inherits all of it and adds two scoped exceptions, both already vetted by the
research artifacts.

### Things that stay non-negotiable

- **No auth, no DB, no analytics, no persistent server state.** Every byte of
  state for Maze Hunt lives in browser memory or `localStorage`. Cross-device
  sync is *explicitly* not in scope; if Andrew asks, it is a separate product
  decision.
- **No server-side PDF generation.** Maze Hunt PDFs are built in the browser
  with `pdf-lib` (already a dependency, dynamically imported on Generate),
  exactly as Pixel Puzzle does today.
- **No env vars required by the page itself.** The existing email route
  (`app/api/send-puzzle-email/route.ts`) keeps `RESEND_API_KEY`; this plan does
  not introduce new secrets.
- **No A4 mode, no custom paper sizes, no portrait/landscape toggle.** Letter
  portrait, 612×792 pt, hard-coded.
- **Wiki proxy stays tight.** The `Invicon_*.png` allowlist regex in
  `app/api/wiki/route.ts` is **not** widened in v1. New blocks and entities
  needed for Maze Hunt are fetched at *build* time directly from the wiki by
  `scripts/build-catalog.ts` (no proxy involved) and shipped as static
  thumbnails under `public/blocks/` and `public/entities/`.
- **Polite User-Agent (`DavisPuzzleWeb/1.0 (OT therapy worksheets)`)
  preserved** for both runtime proxy fetches and build-time scrapes.
- **Pixel Puzzle product remains unchanged.** Same URL, same form, same PDF
  output, same 4-page contract, same item catalog reads.

### Two scoped exceptions, both deliberate

1. **Catalog schema bump (v1 → v2).** `lib/catalog.ts` gains a discriminated
   `kind: "item" | "block" | "entity"` field. The `items: [...]` slice in
   `public/items.json` keeps every v1 field intact and the Pixel Puzzle
   product's reads are unchanged; new `blocks: [...]` and `entities: [...]`
   slices are added alongside. Schema marker bumps from `_schema: 1` to
   `_schema: 2`. **Atomic update required:** the existing
   `isCatalogFile()` validator strict-checks `file._schema ===
   CATALOG_SCHEMA_VERSION`, and `app/CatalogBrowser.tsx` rejects any payload
   that fails that check. So Epic 1 must change `CATALOG_SCHEMA_VERSION`,
   the validator, the `CATEGORY_LABELS` map, the build-script validation,
   the regenerated `public/items.json`, and any tests that read the schema —
   in a single PR — or the Pixel Puzzle product breaks on next refresh.
2. **The CLAUDE.md "exactly four pages" rule scopes to Pixel Puzzle.** Maze
   Hunt is a different PDF class with one worksheet per page (single-page when
   child + answer are co-located, two-page when split, N-page for batch print
   if/when v1.1 ships batch). Section 9 of `web/CLAUDE.md` should be updated
   when Epic 3 lands so future readers don't misapply the rule.
3. **The CLAUDE.md "no custom asset/fonts" rule scopes to fonts.** Maze Hunt
   adds static, audited PNG art for blocks, entities, and theme cards
   (sourced at build time from `minecraft.wiki` with the existing polite
   User-Agent and shipped as static assets under `public/`). These are not
   custom fonts and do not violate the rule, but the wording in
   `web/CLAUDE.md` is ambiguous — clarify when Epic 1 lands that "no custom
   asset/fonts for PDF rendering" means **no custom font files**, and that
   wiki-sourced static block/entity art is in scope.

### Things the research surfaced as tempting but explicitly *not* shipping

- **Free-form maze authoring / hand-editing of walls.** This is the apex
  predator of scope-creep in this product and the single most consistent
  finding across the research artifacts. The fix when Andrew dislikes a maze
  is the **re-roll button**, not a wall editor. Hard-no, ever.
- **Custom non-canonical assembly authoring.** Same apex-predator class. Hard-
  no for v1 and v1.1.
- **Per-child accounts, rosters, longitudinal progress tracking.** Tips
  squarely into HIPAA territory and breaks every "no DB / no auth" non-
  negotiable. Not a feature; a separate product decision.
- **Custom Minecraft pixel font for "Item Hopper" / "Furnace" / "Crafting"
  labels.** Defer to Helvetica-Bold with biome-anchored description text.
  Revisit only on Andrew's explicit request.
- **Cross-device sync of presets.** Same DB+auth implication as per-child
  rosters. v1 ships JSON export/import as the canonical persistence boundary.

---

## 3. The unified UX (module-by-module)

The shape Andrew sees, end-to-end, after all five epics ship.

### 3.1 Information architecture

```
/                               Davis Puzzle landing
├── tab strip
│   ├── [Pixel Puzzle]          (existing, default-on-load via localStorage)
│   └── [Maze Hunt]             (new in Epic 4)
└── active panel
    ├── PixelPuzzlePanel        (existing UI extracted unchanged)
    └── MazeHuntPanel
        ├── ActivitySelector    (Epic 4 — theme cards + difficulty pills)
        └── Editor              (Epics 1–3 — maze + collectibles + assembly + objectives + print)
```

**Single page, two tabs.** No new routes. Pixel Puzzle stays default for
returning users; the user's last-picked tab persists in `localStorage`.

### 3.2 Module taxonomy inside the Maze Hunt editor

Five composable modules. Each is a research artifact in
`web/planning/maze-hunts/`.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Maze Hunt Editor                                                   │
│                                                                     │
│  ┌───────────────────────┐   ┌────────────────────────────────────┐ │
│  │  Theme bundle picker  │   │  Difficulty preset (Easy/Med/Hard) │ │
│  │  (Epic 4 / Feature 1) │   │  (per-theme defaults)              │ │
│  └───────────────────────┘   └────────────────────────────────────┘ │
│                                                                     │
│  ┌────────────────────────────────────────────────┐                 │
│  │  Maze module (Epic 1 / Feature 2)              │                 │
│  │  silhouette · cell preset · entrance/exit      │                 │
│  │  re-roll · seed footer                         │                 │
│  └────────────────────────────────────────────────┘                 │
│                                                                     │
│  ┌────────────────────────────────────────────────┐                 │
│  │  Collectibles module (Epic 2 / Feature 4)      │                 │
│  │  count preset · all-on-path / mixed mode       │                 │
│  │  multi-item-types · re-roll placement          │                 │
│  └────────────────────────────────────────────────┘                 │
│                                                                     │
│  ┌────────────────────────────────────────────────┐                 │
│  │  Assembly module (Epic 2 / Feature 5)          │                 │
│  │  catalog of 6 canonical builds · cutout size   │                 │
│  │  state-change support (wet→dry sponge)         │                 │
│  └────────────────────────────────────────────────┘                 │
│                                                                     │
│  ┌────────────────────────────────────────────────┐                 │
│  │  Objectives module (Epic 3 / Feature 6)        │                 │
│  │  auto-generated checklist · per-line override  │                 │
│  └────────────────────────────────────────────────┘                 │
│                                                                     │
│  ┌────────────────────────────────────────────────┐                 │
│  │  Print module (Epic 3 / Feature 7)             │                 │
│  │  child + answer co-located on Letter portrait  │                 │
│  │  B&W toggle · split-page toggle · footer       │                 │
│  └────────────────────────────────────────────────┘                 │
│                                                                     │
│  ┌────────────────────────────────────────────────┐                 │
│  │  Preset library (Epic 5 / Feature 8)           │                 │
│  │  save / load / rename / delete · JSON i/o      │                 │
│  └────────────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
```

Each module is a self-contained pure-TypeScript library plus its
React-component surface. Cross-module communication is one-way and
typed: theme bundle → maze config → maze grid → collectible placement →
assembly + objectives → print orchestrator → preset persistence.

---

## 4. Phased epic plan

Five epics, sequenced for vertical-slice progress. Every epic ends in a thing
Andrew can hold in his hand or send to a printer.

### Epic 1 — Foundation: Catalog Expansion + Maze Generator

**Scope:** Features 3 (block + entity catalog expansion) and 2 (procedural
maze generator).

#### Why this epic exists

Every downstream feature depends on (a) having the right Minecraft assets
available in the catalog (sponge, soul sand, ladder, ender dragon, etc.) and
(b) a deterministic procedural maze the editor can render. These are the two
unblockers without which nothing else can ship. They also have minimal user-
facing surface, which makes them the right place to land the schema and
algorithmic decisions before UI is at stake.

#### What ships

**Catalog (Feature 3):**
- Schema bump: `lib/catalog.ts` from v1 to v2 with `kind: "item" | "block" |
  "entity"` discriminator. `CatalogItem` aliased to `CatalogItemAsset` for
  back-compat with Pixel Puzzle reads.
- `public/items.json` becomes a v2 file with `items[]`, `blocks[]`,
  `entities[]` arrays. `_schema: 2`. Pixel Puzzle product reads `items[]` and
  is unchanged.
- ~30 new blocks under `public/blocks/*.png`, including all PDF-validated
  blocks (sponge, wet sponge, soul sand, soul soil, wither skeleton skull,
  obsidian, ladder) plus per-biome dressing (end stone, end rod, chorus
  flower/fruit, dark prismarine, prismarine bricks, sea pickle, glowstone,
  netherrack, etc.).
- ~12 new entities under `public/entities/*.png`, frame-0-extracted from GIFs
  where applicable (Ender Dragon, Wither, Elder Guardian, Iron Golem, Snow
  Golem, Allay, Warden, Blaze, Wither Skeleton, Skeleton, Zombie, Creeper).
- Build script (`scripts/build-catalog.ts`) extended with `BLOCK_SEEDS` and
  `ENTITY_SEEDS` lists. Block seeds support a `sourceFilenameOverride` for
  the 5 known non-Invicon blocks (Sculk, Sea Lantern, End Crystal,
  Prismarine, plus any future entry without an `Invicon_*.png`). Entity
  seeds always specify `sourceFilename` explicitly because the
  `_JE<n>_BE<n>` suffix is non-derivable.
- **Proxy allowlist unchanged.** Build-time scraping bypasses the proxy;
  runtime serves pre-baked thumbnails as static assets.

**Theme bundle data (foundation for Epic 4):**
- `public/maze-hunt-themes.json` static data file with the 3 v1 themes
  (End Island, Nether, Ocean Monument), full `MazeHuntTheme` records
  including silhouette, item refs, boss, assembly, objective phrasing
  templates, and per-theme difficulty defaults.
- `lib/mazeHuntThemes.ts` exports the typed shape + a loader that the
  Epic 4 selector UI consumes. Authoring this in Epic 1 — alongside the
  catalog and maze code — is the only way to verify that every theme's
  asset references actually resolve before any UI is built.
- **Pluralization fields baked into the catalog v2 schema** to support
  Feature 6: `displayNameSingular`, `displayNamePlural`, `massNoun`
  (boolean), and optional `pluralOverride`. Soul sand is a mass noun
  ("4 blocks of soul sand"); wither skull pluralizes normally ("3 wither
  skulls"). These flags are populated per asset in F3's seed list.

**Maze (Feature 2):**
- `lib/maze.ts` core generator using **recursive backtracking (DFS)** on a
  boolean `inShape` mask. Closest visual match to Andrew's PDF aesthetic, ~80
  LOC, trivially mask-aware.
- `lib/maze/silhouettes.ts` rasterizes 3 silhouettes: `circle`, `star4`,
  `rectangle`.
- **`pdf-lib` 1.17.1 spike up front.** Confirm the dashed-with-chevrons
  answer-key path renders correctly using `borderDashArray` (the actual
  parameter name on `drawSvgPath` — *not* `dashArray`) and that
  `borderDashPhase`, `borderLineCap`, and `borderOpacity` behave as
  expected. Single afternoon spike before maze rendering work begins;
  produces a one-page test PDF that locks the dash/chevron parameters.
- **Build-time image dependencies:** add `sharp` and `gifuct-js` (or
  equivalent GIF frame-0 extractor) as `devDependencies`. Neither is
  shipped to the client; both run only in `scripts/build-catalog.ts` for
  resampling entity portraits and extracting GIF frame 0 for animated
  entity art (Ender Dragon, Elder Guardian, etc.).
- `lib/maze/rng.ts` — small seedable PRNG (sfc32 or xorshift32, ~30 LOC).
- `MazeGrid` data shape exposes `cells`, `walls`, `entrance`, `exit`,
  `solutionPath`, `distanceFromEntrance`, `deadEnds`, `inShape`, `seed`. F4
  consumes `solutionPath`, `deadEnds`, and `inShape`; F7 consumes `walls`.
- `lib/pdf/maze.ts` renders a `MazeGrid` into a `pdf-lib` page via a single
  SVG path string per layer (boundary 1.5pt, interior 0.75pt) using
  `drawSvgPath`.
- 6-character base32 seed printed in the page footer alongside the date.
- Re-roll button in the editor.
- B&W safety toggle (one checkbox, switches the answer-key path from red to
  dashed-with-chevrons; default off in v1, see Epic 3).

#### How it comes together

A scratch `/maze` page (or the eventual Maze Hunt panel stub) lets a developer
pick silhouette + cell-count preset + entrance/exit + seed, hit Generate, and
download a Letter PDF containing only the maze and a footer. No collectibles,
no assembly, no checklist. This proves the pipeline end-to-end.

#### Pitfalls (research-backed)

- **Pencil-precision-band breakage.** Cells under ~17pt produce sub-6mm
  corridors that kids cannot draw inside. Maze module clamps cell count down
  per silhouette and surfaces a "reduced for print safety" note rather than
  rendering an unusable maze.
- **Boundary rendering on circular/star silhouettes.** Use heavier stroke
  weight on the silhouette outer wall (1.5pt) and snap wall coords to whole
  pt values to avoid sub-pixel anti-aliasing fuzz.
- **Determinism / reproducibility.** Without a seed, Andrew cannot reproduce
  last week's maze. Print the seed in the footer; accepting seed input as a
  v1.1 enhancement.
- **Entity portrait sizes.** Animated GIFs up to 1.4MB (Ender Dragon) cannot
  be embedded by `pdf-lib` and would blow up worksheet output. Build script
  extracts frame 0 to PNG and resamples to a `defaultDisplaySize` (160–200
  px) at build time using `sharp`.
- **Catalog schema break-on-strict-version-check.** Bump `_schema` to 2 but
  keep all v1 reads working; existing `isCatalogFile()` only checks
  presence of the version field, not equality.

#### Scope limits

- **No custom shape upload.** Hard-no, ever.
- **No hand-editing of maze walls.** Hard-no, ever.
- **No loop / multi-path mazes.** Single-solution perfect mazes only.
- **No continuous cell-count slider.** Three presets per silhouette.
- **No corridor density / dead-end dial.** One default per cell-count preset.
- **No off-center boss placement.** Always-center; Boss Hunt-style off-center
  comes only on Andrew's request.
- **No seed in URL.** Seed lives in the page footer only.
- **No catalog uploads.** Andrew cannot upload custom Minecraft skins. The
  catalog is a static, audited library.
- **No widening of `/api/wiki` allowlist.** Still `Invicon_*.png` for
  runtime; everything new goes through build-time scraping.

#### Success criteria

- `pnpm catalog:build` produces an `items.json` with 138 items (unchanged) +
  ~30 blocks + ~12 entities, plus all thumbnails on disk and the new
  pluralization fields populated per asset.
- `_schema: 2` payload passes the updated `isCatalogFile()` validator;
  `app/CatalogBrowser.tsx` continues to load without modification beyond
  whatever is required for the validator update; existing Pixel Puzzle UI
  unchanged.
- `pnpm build && pnpm lint` clean on the existing Pixel Puzzle product after
  the schema bump.
- `public/maze-hunt-themes.json` resolves all asset references against the
  freshly-built `items.json` (every `canonicalName` mentioned in any theme
  exists as an `item`, `block`, or `entity`).
- A Letter PDF generated for each of {circle, star, rectangle} × {Small,
  Medium, Large} renders with corridors ≥17pt, walls cleanly drawn at print
  fidelity, and the seed printed in the footer.
- Dashed-with-chevrons answer-key path test PDF (from the `pdf-lib` spike)
  renders crisply on a 300dpi B&W printer.
- Same `(silhouette, cellPreset, entrance, exit, seed)` produces a
  **clinically equivalent** PDF across runs (same maze layout); a separate
  test that freezes generation timestamp + seed + renderer version
  confirms byte-identical output. (See §9 contracts appendix on the two
  determinism levels.)
- Pixel Puzzle's existing production smoke (`pdfinfo` checks, item-count
  spot-checks) all pass unchanged.

#### Why it matters for Andrew

Without Epic 1, Andrew has nothing new to print. With it, he can hand a kid a
Minecraft maze worksheet — not yet a full Maze Hunt, but the graphomotor-
planning core that the rest of the product is built around (the maze
corridors are the densest motor / graphomotor channel in the worksheet; cf.
analysis §6 ¶4).

---

### Epic 2 — Collectibles + Assemblies

**Scope:** Features 4 (collectible auto-placement) and 5 (assembly template
renderer).

#### Why this epic exists

The maze alone is a maze. With collectibles, it becomes a hunt. With an
assembly, the worksheet has a tactile, satisfying conclusion. Together these
two features bring the worksheet from "shape on a page" to "the activity
Andrew's PDF actually documents." They are sequenced together because they
share the same downstream consumer (the print orchestrator in Epic 3) and
because their shared coupling — collectible counts must equal cutout counts —
benefits from being built in lockstep.

#### What ships

**Collectibles (Feature 4):**
- `lib/placement.ts` exposes `placeCollectibles(input): PlacementResult`,
  pure deterministic function.
- Two modes shipped: `all-on-path` (default, easy) and `mixed`
  (configurable on/off ratio).
- Multi-item-types support (page 2 hard requirement: 3 wither skulls + 4
  soul sand on the same maze).
- Count preset (Low / Medium / High), tied to maze size — High count + Small
  maze gracefully fails with a friendly `PlacementInfeasible` error rather
  than half-placing.
- Re-roll-placement button (separate from re-roll-maze) — same maze, new
  placement seed, sub-second.
- Spanning-tree property of perfect mazes is exploited so no TSP solver is
  needed: walk along the canonical path, detour into branches for off-path
  collectibles. O(N) algorithmic cost.

**Assemblies (Feature 5):**
- `lib/assemblies.ts` ships a **curated catalog of 3 PDF-validated canonical
  Minecraft assemblies for v1**:
  1. **Obsidian Pillar + Ladders** (PDF page 1) — vertical 1-column 5-cell
     template, `count` scaling axis, blank answer key.
  2. **Wither Summon** (PDF page 2) — canonical T-shape recipe (4 soul sand
     + 3 wither skulls), positional constraints, pre-pasted answer key.
  3. **Hopper + Furnace** (PDF page 3) — 5×2 hopper grid + furnace side-
     panel, **state-change support** (wet sponge cutout → dry sponge in
     answer key), pre-pasted answer key.
- **Crafting Table, Brewing Stand, Snow Golem deferred to v1.5.** Each of
  the three brings new asset dependencies (crafting-table block, brewing-
  stand block, snow-block, blaze-powder, glass-bottle) that are not
  guaranteed by Epic 1's seed list, and Andrew has not yet validated the
  clinical use case for any of them. Adding them to v1 expands Epic 1's
  asset matrix and ships unproven assemblies; deferring keeps v1 honest
  to the PDF samples. v1.5 should also add Iron Golem, Beacon Pyramid, and
  End Portal Frame to the same wave.
- `lib/pdf/assembly.ts` renders the target template as a panel of slot
  rectangles with embedded item icons where the answer key reveals.
- `lib/pdf/cutouts.ts` renders the strip of black-bordered cuttable squares
  in 3 size presets (16pt / 22pt / 28pt) with 1.0–1.5pt borders.
- **Cutout count is owned by the assembly, not by F4.** Each `Assembly`
  declares its own `cutoutPanel: CutoutSpec[]`; the renderer prints exactly
  that many cutouts regardless of how many collectibles are in the maze.
  The PDF page 1 case is the proof: 6 ender crystals on the maze + 5
  ladder cutouts on the side (different counts, deliberate). What *does*
  auto-sync from F4's `PlacementResult` is the **prompt count token**
  consumed by Feature 6 ("Collect 6 ender crystals." derives the `6` from
  placement, not from the cutout panel). See the cross-feature contracts
  appendix (§9) for the exact handoff shapes.
- Helvetica-Bold + biome-anchored description text for container labels
  ("Hopper", "Furnace", "Crafting Table") — replaces the PDF's pixel-font
  labels per the no-custom-fonts non-negotiable.

#### How it comes together

The scratch maze page from Epic 1 grows into a real Maze Hunt page rendering
the End Island worksheet (PDF page 1 parity). Pick End Island defaults,
generate, see: circular maze with 6 ender crystal collectibles auto-placed on
the solution path, an obsidian pillar with 5 ladder cutouts on the right, no
checklist yet (Epic 3), no answer-key bottom half yet (Epic 3). The print
output is one Letter portrait page with the top half populated.

#### Pitfalls (research-backed)

- **Pixel parity between cutout and slot.** A 22pt cutout must paste into a
  22pt slot exactly. Cutout-size preset drives both renderers from a single
  constant.
- **Thin cutout borders degrade at low printer DPI.** School laser printers
  may render 0.4pt borders as hairlines kids' scissors can't follow. Floor
  cutout border at 1.0pt; 1.5pt recommended.
- **State-change asset coupling.** Hopper + Furnace requires both `wet_sponge`
  and `sponge` as separate assets in the F3 catalog. Build of Epic 1 must
  ship both.
- **Placement infeasibility surfacing.** `PlacementInfeasible` results must
  hit the existing `lib/errors.ts` discipline and produce friendly UI copy
  ("Try a smaller maze, fewer items, or re-roll").
- **Visual collision between collectibles and walls.** Use graph-distance
  (Manhattan along corridors) for minimum-spacing, not Euclidean. Snap
  sprite center to cell center; clamp sprite size to ≤80% of cell width.
- **Re-roll semantics ambiguity.** Two distinct buttons: "Re-roll layout"
  (cheap, keeps maze) vs. "Re-roll maze" (resets placement). Label both
  unambiguously.
- **Mixed-type prompt counting (page 2).** F4 outputs placements grouped by
  `itemRef` so F6 can iterate and write "3 wither skulls" + "4 soul sand"
  rather than "7 items".

#### Scope limits

- **No sequenced collection in v1.** Algorithmically trivial but clinically
  meaningless without a numbered-sprite affordance. Defer until Andrew
  confirms he wants ordered collection AND we have a clean numbering UI.
- **No lock-individual-position drag-to-fine-tune.** The §5 scope-creep
  trap. Re-roll is the answer.
- **No region constraints.** Declarative, forward-compatible in the data
  shape, but no UI in v1.
- **No per-slot item override on assemblies.** Catalog defaults only.
- **No custom assembly authoring.** Hard-no, ever.
- **No pre-cut mode** (separate page of cutouts pre-spaced for facilitator
  pre-cutting). Defer pending Andrew's confirmation that he wants it.
- **No multiple assemblies per worksheet.** Hopper + Furnace counts as one
  pre-coupled exception, treated as a single assembly entry.

#### Success criteria

- The End Island worksheet (top half only, no answer key yet) matches the
  PDF page 1 layout: circular maze with 6 ender crystals on the solution
  path, obsidian pillar template with 5 ladder cutouts.
- The Nether worksheet renders 3 wither skulls + 4 soul sand on a star maze
  with the canonical Wither summon T-shape template.
- The Ocean Monument worksheet renders 10 wet sponges and the Hopper +
  Furnace template, with the answer-key state showing dry sponges (wet→dry
  state change).
- `placeCollectibles()` returns identical placements for identical
  `(maze, population, mode, seed)` inputs across runs.
- `PlacementInfeasible` failure modes (`infeasible-not-enough-off-path`,
  `infeasible-spacing-too-tight`, `infeasible-type-constraint`) all surface
  through `lib/errors.ts` to friendly UI strings.

#### Why it matters for Andrew

After Epic 2, Andrew has the *core therapeutic value* of Maze Hunt: a
graphomotor maze, target acquisition demands, and a tactile cut-and-paste
assembly that turns the worksheet into an earned 3D-feeling artifact. The
clinical channels (analysis §6) all light up: target acquisition under
distraction, route planning, scissor work, glue handling, spatial mapping,
state-change cognition. From this point on, Andrew can use the tool with
real kids; subsequent epics are about polish and scale, not capability.

---

### Epic 3 — Objectives + Print Layout

**Scope:** Features 6 (objective list composer) and 7 (two-up child + answer
print layout).

#### Why this epic exists

A worksheet without a checklist is a graphomotor exercise without an
executive-function anchor. A worksheet without an answer key is a worksheet
that costs Andrew time to facilitate. Epic 3 closes both: the top-of-page
checklist that does real EF work, and the bottom-half facilitator answer key
with the solution path drawn in red, all on a single Letter portrait page.

#### What ships

**Objectives (Feature 6):**
- `lib/objectives.ts` exposes a phrasing template library with 5 named slots:
  `navigate`, `find`, `escape`, `craft`, `state-change`.
- Default phrasing matches PDF verbatim (e.g. "Navigate to all 6 ender
  crystals.", "Enter the center of the maze and slay the Ender Dragon.",
  "Escape the Maze.", "Cut out the ladders and glue them on the pillar.").
- Tokens: `{count}`, `{item-singular}`, `{item-plural}`, `{boss}`, `{target}`.
- Pluralization via ad-hoc rules driven by two new catalog flags F3 must
  populate: `pluralOverride` and `massNoun` (so "soul sand" renders as
  "blocks of soul sand" while "wither skull" pluralizes normally).
- Inline per-objective text override (click-to-edit).
- Count auto-sync: the navigate-slot count token rebinds to the live
  placement count from F4. Override-vs-regenerate behavior: **override
  wins, badge the mismatch** (the recommended "clinical trust" default).
- Terminal craft step is always present and non-removable (orphaned
  assemblies are a clinical anti-pattern).

**Print layout (Feature 7):**
- `lib/pdf/mazeHunt.ts` orchestrator owns the two-up Letter portrait page.
- Page splits horizontally at `y = 396`; each half is 612 × 396 pt.
- 36pt outer margins, 16pt inner top padding, 24pt inner bottom padding.
- Layout regions per half:
  - Header band (32pt): Name line top-right, optional "Objectives: N"
    badge top-left.
  - Body band (324pt): 2-column grid, 320pt left + 16pt gutter + 204pt
    right. Left column has the checklist (40pt) over the maze (276pt).
    Right column has the assembly target (180pt) over the cutout strip
    (132pt).
- Maze cell budget: cell ∈ [18, 24] pt, grid ∈ [13×11, 17×14] depending on
  difficulty preset. Floor at cell=18pt to honor the pencil precision band.
- Cutout square budget: cutouts ∈ [36, 52] pt; up to 10 cutouts per half at
  the minimum cell size (page 3's 10 sponges fit, barely).
- Bottom half mirrors top half exactly with -396pt offset; horizontal
  mid-rule at y=396 (0.4pt thin).
- **Solution path rendering** on the answer copy:
  - Default: red solid stroke, 2.4pt, opacity 0.85 (lets walls and
    collectibles show through).
  - B&W-safe alternative behind a toggle: dashed black `[6,4]` with
    chevron arrowheads every 4 cells, 5pt size, 1pt stroke. Recommended
    Option B from the F7 research because it survives 300dpi B&W printing
    and reads as motion rather than as a wall.
- **Watermark "FACILITATOR COPY"** rendered at 0.15 opacity, light gray, -30°
  rotation across the answer copy. Default on (cheap accident protection if
  Andrew accidentally hands the answer key to a kid).
- **Footer** composition: session label (free text, blank by default) + ISO
  date + difficulty descriptors (auto-derived: "Maze: medium / Cutouts:
  small / Objectives: 4"), via existing `drawFooter` styling.
- **Split-page toggle:** ships in v1, default off, single switch in editor.
  When on, child copy is page 1 and answer copy is page 2 with "Page 1 of
  2" / "Page 2 of 2" footers.

#### How it comes together

After Epic 3, Generate produces a complete printable PDF for any of the
configured themes. Click Generate → preview shows a stepper (Summary, Answer
key, Coordinate-style maze, Collectibles, Cutouts) → Confirm Download writes
`<theme_id>_maze_<seed>.pdf` to disk. The worksheet is functionally identical
to Andrew's existing PDFs, with the addition of a footer descriptor and an
optional B&W-safe path style.

#### Pitfalls (research-backed)

- **Maze cell sizing below the pencil-precision band.** The half-page
  layout floors at cell=18pt. Never let any preset go below.
- **Item icon overlap with maze walls in half-height layout.** 2pt margin
  on icons inside cells; render icons after walls in z-order.
- **Answer-key answer-leaking on the same page.** The kid can see the
  bottom half. Watermark + split-page toggle are the mitigations; Andrew
  picks per-session.
- **B&W printers desaturating red.** Red drops to mid-gray and dies
  against black walls. The B&W-safe toggle is mandatory; assume the worst
  printer in any clinic.
- **Cutout square size at print fidelity.** Below ~36pt unscissorable;
  above ~52pt and 10 cutouts won't fit. Tight floor and ceiling; collectible
  count knob clamps it.
- **Pixel-font label fidelity gap.** PDF page 3's "Item Hopper" pixel font
  is replaced with Helvetica-Bold per CLAUDE.md "no custom fonts" — slight
  visual departure from source PDF, deliberate concession.
- **Footer date drift on regeneration.** Andrew prints today, prints again
  tomorrow with the "same" config — footer date silently differs. This is
  intentional but should be obvious; document in editor tooltip.
- **Pluralization edge cases.** "1 sponge" vs. "5 sponges" vs. "soul sand"
  (mass noun). Catalog flags + ad-hoc rules; no `Intl.PluralRules`.
- **Override-vs-count-mismatch trust.** When Andrew edits an objective text
  to "Find 8 ender crystals" and then sets count to 6, who wins? Override
  wins, badge the mismatch. Confirm with Andrew before ship.

#### Scope limits

- **No reorder objectives.** Defer.
- **No reading-level dial.** Defer; one register only (PDF default
  imperative voice).
- **No conditional / compound / multi-step objectives.** Hard-no.
- **No multilingual support.** Hard-no.
- **No child-name personalization in objectives.** PII concern; defer
  pending clinical conversation.
- **No multi-worksheet batch print.** Defer to v1.1.
- **No cover sheet.** Maze Hunt has 1 worksheet per PDF; cover is
  redundant.
- **No PII fields.** No clinic name, no practitioner name, no child name
  beyond the on-page Name underline.
- **No A4, no Legal, no custom margins.** Hard-no.

#### Success criteria

- Generated End Island PDF reproduces PDF page 1 layout: top half = circular
  maze + 6 ender crystals + objective checklist + obsidian pillar + 5
  ladder cutouts + Name line; bottom half = same with red solution path
  drawn through the maze and the pillar/ladders blank (PDF page 1 keeps
  pillar blank in the answer copy).
- Generated Nether PDF reproduces PDF page 2: star maze + 3 wither skulls +
  4 soul sand + Wither T-template with cutouts pre-pasted in the answer.
- Generated Ocean Monument PDF reproduces PDF page 3: rectangular maze + 10
  wet sponges + Hopper grid + Furnace, with the answer copy showing dry
  sponges in the furnace output column.
- B&W-safe toggle produces a legible answer-key path on a 300dpi grayscale
  printer.
- Watermark renders at correct opacity and rotation; legible-but-not-
  distracting.
- Footer shows session label (when set), date, and difficulty descriptors.
- `pdfinfo` reports correct title, author, subject, 1 or 2 pages depending
  on split toggle.

#### Why it matters for Andrew

After Epic 3, Andrew has full PDF parity with the worksheets he already runs
in the clinic. The print quality matches or exceeds the source PDF (sharper
walls, B&W-safe path option, watermarked answer key, footer descriptors).
Andrew can stop hand-curating PDFs and start using the tool as his primary
worksheet authoring surface. This is the **"Andrew's Tuesday is faster than
last Tuesday"** epic.

---

### Epic 4 — Activity Selector + Theme Bundles

**Scope:** Feature 1 (activity selector + biome theme bundles).

#### Why this epic exists

Epic 3 ships a Maze Hunt editor, but no front door. Epic 4 is the front
door. Until now, Andrew was driving the editor with hard-coded defaults; this
epic gives him the **theme-card pick** that turns "configure 30 fields" into
"click End Island." It also makes the existing Pixel Puzzle product
explicitly a sibling to Maze Hunt (tab strip), preventing either product from
demoting the other.

#### What ships

- **Tab strip** at the top of `/`: `[Pixel Puzzle] [Maze Hunt]`. Pixel
  Puzzle is default-on-load for first-time visitors. Last-picked tab
  persists in `localStorage` (`davis.activeTab` or similar; same pattern as
  `app/CatalogBrowser.tsx`'s `STORAGE_KEY`).
- **`MazeHuntActivitySelector` component** showing 3 PDF-validated theme
  cards in a responsive grid:
  - **End Island** — circular silhouette, ender crystals, Ender Dragon
    boss, obsidian pillar + ladders assembly.
  - **Nether** — diamond/star silhouette, wither skulls + soul sand,
    Wither boss (corner-decorative), canonical Wither summon T.
  - **Ocean Monument** — rectangular silhouette, wet sponges, Elder
    Guardian boss (center), hopper + furnace with state change.
- **Forest theme deferred to v1.5.** The Forest theme would require a
  `rounded-rectangle` silhouette (not in Epic 1's three), a Wolf entity
  (not in Epic 1's 12), and the crafting-table-3×3 assembly (deferred per
  Epic 2). Capping v1 at the 3 PDF-validated themes keeps the asset
  matrix tight, the typography concession scoped, and the v1 product
  honest to the worksheets Andrew has actually used in clinic. v1.5 adds
  Forest along with Mineshaft / Village / Ancient City as a deliberate
  theme expansion wave once Andrew has shipped real sessions on v1.
- Each card: thumbnail PNG (~256×256, ~20KB) + 1-line description + 3-pill
  difficulty selector (Easy / Medium / Hard) + "Open editor →" CTA.
- Difficulty pills cycle on tap; each theme carries its own
  `difficulties: Record<DifficultyPreset, MazeHuntDifficultyDefaults>` so
  Easy-Forest is genuinely sized for Forest, not a global Easy.
- **`public/maze-hunt-themes.json`** is already shipped by Epic 1 (the
  three v1 records). Epic 4 only consumes it; adding a 4th theme later is
  a config change (one JSON entry + one thumbnail) plus whatever new
  silhouette / asset dependencies that theme drags in.
- **Sticky last-pick** in `localStorage` — `davis.maze-hunt.last-pick`
  remembers `{ themeId, difficulty, timestamp }`; renders a "Last used: End
  Island — Medium · 3 days ago [Resume editor →]" line under the cards.
- Click card or CTA → editor opens in-place (scroll-down), not a route
  change.

#### How it comes together

After Epic 4, Andrew lands on `/`, sees both products as equal-weight tabs,
clicks Maze Hunt, picks End Island, taps Medium, clicks Open editor, sees the
editor with sensible defaults already filled, hits Generate, hits Confirm
Download. Total interaction: ~5 clicks from cold start to PDF on disk.

#### Pitfalls (research-backed)

- **Overwhelm by theme count.** Cap at 3 in v1 (PDF-validated only). Add
  slowly only after Andrew has used v1 in real sessions and asked for
  more.
- **Silent print degradation per theme.** Per-theme difficulty tables are
  critical: Easy-Forest ≠ Easy-Ocean in cell count.
- **Editor confusion under time pressure.** Card pick must pre-fill *every*
  default (maze silhouette, palette, boss, assembly, objective text) so the
  editor opens **ready to print**.
- **Existing Pixel Puzzle gets buried.** Both tabs visually equal-weight;
  default-on-load is the user's pinned tab, not always Maze Hunt.
- **Single-page-app constraint creep.** Resist the temptation to give Maze
  Hunt its own `/maze` route. Tab strip on `/` is the v1 answer.
- **Theme bundle drift from real Minecraft.** Every shipped theme uses real
  biome + real items + real assembly. No invented Mineshaft assemblies.

#### Scope limits

- **No saved presets in the selector.** The selector reads `last-pick`
  only; preset write-path is Epic 5.
- **No custom theme upload.** Hard-no.
- **No per-theme override at the selector level.** Override happens inside
  the editor.
- **No favorites pinning, hidden themes, theme-versioning resolver.** Add
  `version: 1` field to data shape now (forward-compat) but don't build
  the resolver.
- **No per-child theme bundles.** Hard-no — implies database.
- **No themes 5+.** Ship later as data-only adds.
- **No query-string deep links.** No `?theme=end-island` in v1.

#### Success criteria

- `/` renders the tab strip; both tabs are visually equal-weight.
- Refresh after picking Maze Hunt keeps Maze Hunt active.
- Pixel Puzzle product behavior is byte-identical to pre-Epic-4 (all
  existing production smoke checks pass).
- All 3 theme cards render with correct thumbnails, descriptions, and
  difficulty pills.
- Clicking a card opens the editor in-place with the correct theme defaults
  loaded; Generate produces a worksheet that matches the theme's clinical
  shape.
- "Resume editor" line appears only when `last-pick` is set; clicking it
  reloads the last theme + difficulty.

#### Why it matters for Andrew

Epic 4 is the **30-second-from-cold-start** epic. After it lands, Andrew can
walk up to a Chromebook, open the URL, click two cards, and walk away with
a printed worksheet — without ever seeing the editor's individual knobs
unless he chooses to. This is the moment Maze Hunt becomes a tool he reaches
for *first*, not a generator he reaches for after he's already decided what
he wants.

---

### Epic 5 — Preset Library

**Scope:** Feature 8 (local preset library + JSON import/export).

#### Why this epic exists

Andrew runs the same difficulty bundle for multiple kids in a week. Without
a preset library he reconstructs the configuration each time. With it, he
saves "Tuesday-Class-EndIsland-Easy" once, reloads it the next Tuesday,
optionally re-rolls the maze for each kid (so no two kids in the same group
get the same layout), and prints. The preset library is the productivity
multiplier that turns Maze Hunt from "great worksheet" into "great
worksheet, 6 kids per session."

#### What ships

- **`lib/presets.ts`** — pure CRUD module + schema + type guards.
- **`MazeHuntPreset` schema** at `_schema: 1` with stable UUID `id`,
  `name`, `createdAt` / `updatedAt` / `lastPrintedAt`, optional `note`,
  `algoVersions` (pinned per F2/F4/F5/F6 generator versions), and config
  sub-objects from F1–F7 (`themeId`, `mazeConfig`, `collectibleConfig`,
  `assemblyConfig`, `objectivesConfig`, `printConfig`).
- **Two-tier `localStorage` keying**:
  - `davis.mazehunt.preset.index` — thin array of `{ id, name,
    difficultyDescriptor, lastPrintedAt }` for fast list rendering.
  - `davis.mazehunt.preset.{id}` — full preset blob.
- **`app/PresetLibrary.tsx`** — UI with: list view (name + difficulty pills
  + last-printed date, sorted last-printed-desc), Save current as preset,
  Load, Rename, Delete with confirm.
- **`lib/presetIO.ts`** — JSON export (whole library to one downloadable
  file) and JSON import (schema-validated upload, conflict-aware: rename
  / replace / cancel per duplicate).
- **Schema migration scaffolding** — colocated with schema definition so
  future field changes can't ship without a migrator. Imports from
  newer-than-running `_schema` are rejected with a friendly error.
- **Algorithm-version pinning** — when F2/F4/F5 generators change between
  releases in a way that breaks determinism, presets stay reproducible by
  routing through the matching algorithm version.
- **Two-layer seed model** — config seed (saved, drives deterministic
  things like assembly slot order) + run seed (NOT saved by default,
  generated fresh each Generate so Andrew can re-roll a loaded preset for
  each kid in a group). `Lock seeds` checkbox opts into byte-stable
  regeneration.
- **Footer descriptor data shape** handed off to F7 — preset name + date
  + auto-derived difficulty pills printed on the worksheet, so a stack of
  past worksheets is visually triageable without any digital tracking.

#### How it comes together

After Epic 5, Andrew opens the editor, configures a worksheet, hits "Save
preset…", names it "Tuesday-EndIsland-Group-Easy", and walks away. Next
Tuesday: open Maze Hunt, see the preset in the library list, click Load.
Editor rehydrates. Click Generate → re-roll → Generate → re-roll for each
kid. Each printed worksheet has the preset name + date + difficulty in the
footer; Andrew can stack them in a folder and visually triage by footer.

For clinic↔home portability: Settings → "Export presets" downloads
`davis-mazehunt-presets-{date}.json`. Take it home, open the same app, hit
"Import presets", upload the file. All presets restored.

#### Pitfalls (research-backed)

- **`localStorage` cleared by browser settings.** Andrew loses all presets
  silently. Mitigation: document the JSON export/import workflow as the
  canonical persistence boundary; add a "backup your presets" nudge in
  v1.1 if Andrew reports loss.
- **Preset format drift across app versions.** Schema version + migration
  code in `lib/presets.ts`. Migrators are idempotent and write back
  upgraded presets to localStorage on load.
- **Determinism break across releases.** If F2 algorithm changes between
  releases, old presets render differently. Mitigation: `algoVersions`
  pinning with version-routed generators. Add the `algoVersions` field
  in v1 even though we won't need it until v2 — it's cheap now, expensive
  to retrofit.
- **PII / child names in preset names.** Document in help copy: "preset
  names should not include child PII." Andrew can use generic names like
  "Tuesday-Class-Easy."
- **`localStorage` 5MB cap.** Without thumbnails: ~5,000 presets fit. With
  thumbnails: ~700 presets fit. Both comfortably exceed Andrew's
  realistic library size. No quota tracker UI needed.
- **JSON import attack surface.** Strict schema validation + type guards;
  reject malformed input; never `eval`. Imports validated against the same
  type guards as runtime reads.
- **Import-conflict resolution.** Imported preset has same `id` (or same
  name) as existing → modal: rename / replace / cancel.
- **Cross-device sync expectation.** Andrew may *expect* his presets to
  follow him. Help copy says they don't, and explains the export/import
  flow.
- **Lock-seeds discoverability.** The two-layer seed model is subtle. The
  Lock-seeds checkbox needs a tooltip: "Reproduce the exact same maze on
  every load. Off by default so each generate gives a fresh layout."

#### Scope limits

- **No cross-device sync via cloud.** Hard-no — separate product
  decision; requires DB + auth (breaks `web/CLAUDE.md`).
- **No search by name** (until library grows past ~15).
- **No sort dropdown** (one default sort: last-printed-desc).
- **No folders / tags** (defer until library exceeds ~30).
- **No per-child preset bundling.** PII concern.
- **No "backup your presets" nudge** in v1.
- **No versioned preset history.** "Save as new preset" covers 80%.
- **No auto-export to a known directory.** Browser sandboxed.
- **No per-preset thumbnails** in v1 unless cheap (e.g., F2 already
  exposes a canvas-render path). Otherwise defer.

#### Success criteria

- Save a preset → see it in the list.
- Reload the page → preset still there.
- Click Load → editor rehydrates with the saved configuration; Generate
  produces a *clinically equivalent* worksheet (same difficulty bundle).
- Lock-seeds toggle on → Generate produces *byte-identical* worksheet
  across two runs of the same loaded preset.
- Lock-seeds off (default) → Generate twice in a row produces two
  different mazes with the same difficulty.
- Export → downloads valid JSON. Import on a fresh device → all presets
  restored.
- Schema validation rejects malformed imports with friendly errors.
- Footer descriptor renders preset name + date + difficulty on the
  worksheet.
- Pixel Puzzle product behavior unchanged (Epic 5 touches no Pixel Puzzle
  files).

#### Why it matters for Andrew

Epic 5 is the **week-over-week, kid-after-kid productivity multiplier.**
Andrew runs multiple sessions a day, often the same difficulty bundle
across kids in a group. Without presets he reconfigures every session;
with presets, he configures once per group and reloads. The configure-
once-reload-many pattern is what turns Maze Hunt from "great worksheet"
into "great worksheet at the cadence of a real clinic schedule."

---

## 5. Cross-cutting concerns

### 5.1 Consolidated open questions for Andrew

These are the questions whose answers shape v1 scope. Group them, send
once, fold answers into Epic boundaries.

Reframed for Andrew, not for engineers. Each numbered item assumes the
default we'd pick if Andrew didn't answer; he's only correcting our
defaults.

**Naming and scope (Epic 4):**
1. **What do you call these worksheets?** We're calling them "Maze Hunt".
   Does that match the term you use in clinic, or do you call them
   something else (e.g., "treasure hunt")?
2. **Three biomes for v1?** End Island, Nether (Wither), Ocean Monument.
   Are there other biomes you want available in the first release —
   Forest, Mineshaft, Ancient City, Village — or is the PDF set enough
   for now?
3. **Easy / Medium / Hard, or a different label?** We were planning to
   show three difficulty pills on each theme card. Is "Easy / Medium /
   Hard" the right vocabulary, or would something like "Solo / Group /
   1:1" or "Younger / Older" fit your sessions better?

**The maze itself (Epic 1):**
4. **Always one path through the maze, or do loops sometimes show up?**
   Your PDFs show a single red answer line, so we assume one path. Are
   you ever drawing mazes with multiple valid solutions?
5. **Where does the boss sit in the maze?** Always center (PDF default),
   or do you sometimes put the Ender Dragon / Elder Guardian off-center
   so the kid has to navigate past it?
6. **Does the boss reserve a maze cell, or is it drawn on top of the
   corridor?** Affects whether we carve walls around the center cell or
   just stamp the entity art over the maze.
7. **For the star-shaped Nether maze, where's the entrance?** N/S/E/W
   tips, or NE/NW/SE/SW? Either works.

**Collectibles in the maze (Epic 2):**
8. **Do you ever want collectibles to be visited *in order*?** We're
   defaulting to "any order is fine." If you want kids to collect 1 → 2
   → 3, we'd add numbered icons; otherwise we leave the collectibles
   unlabeled.
9. **How deep should off-path detours go?** If a collectible is hidden
   in a dead-end branch, how many cells deep is too deep before it gets
   frustrating? Our default is 4 cells.

**The cut-and-paste assembly (Epic 2):**
10. **The 3 assemblies in your PDF are obsidian-pillar-with-ladders, the
    Wither summon T, and hopper+furnace. Are there others you use today
    — crafting table recipes, brewing stand, snow golem, iron golem,
    beacon pyramid, end portal frame?** This is the single most scope-
    sensitive question. We default to shipping just the 3 in v1 and
    adding more as a v1.5 wave.
11. **Does the cutout count always need to match the collectible count?**
    Page 1 has 6 ender crystals on the maze but only 5 ladders to cut
    out. Is that on purpose, or should they always match?
12. **Cardstock or paper?** We can recommend cardstock in the help text
    if it makes the cut-and-glue work better.
13. **Do you sometimes pre-cut tiles for younger kids?** If yes, we'd
    add a "pre-cut" mode that prints the cutouts on a separate page
    pre-spaced for facilitator scissor work.

**The objective checklist (Epic 3):**
14. **Reading level?** Your PDFs use plain imperative ("Collect 6 wither
    skulls"). Is that the right register for all your clients, or do
    some need simpler phrasing (e.g., "Find 6 wither skulls.")?
15. **What happens when you edit an objective and then change a
    collectible count?** If you wrote "Find 8 ender crystals" and then
    set collectibles to 6, should we keep your text or update to match
    the new count? We default to keeping your text and showing a small
    badge that flags the mismatch.

**The printed page (Epic 3):**
16. **Is the bottom half of PDF page 3 the same assembly as the top
    half, or different?** The two halves look slightly different in
    the source PDF; we need to know whether the answer copy is meant to
    diverge from the child copy.
17. **Color or black-and-white printing?** Drives whether the answer-key
    solution path defaults to red (color printer) or dashed-with-arrows
    (B&W safe). We default to red with a B&W toggle.
18. **Where should difficulty descriptors print — child copy, answer
    copy, both, or neither?** We default to answer-copy footer only so
    the child doesn't see them.
19. **Should the difficulty / preset descriptor footer print on every
    worksheet, or only when you've explicitly named a preset?** We
    default to always.

**Saving configurations (Epic 5):**
20. **How do you track which difficulty you ran with which kid today?**
    Paper notes, a spreadsheet, nothing? Drives whether v1's preset
    library is enough or whether you'd want richer per-child tracking
    (separate product decision because it implies a database).
21. **Do you work from one computer or multiple?** If multiple (clinic +
    home), the v1 answer is a JSON export/import flow. If you expect
    automatic sync between devices, that's a separate product decision.
22. **When you re-load a saved preset, do you want the *same exact* maze
    every time, or a *fresh* maze at the same difficulty?** We default
    to fresh (so each kid in a group gets a unique maze) with a "lock
    seeds" toggle for byte-stable reproduction.
23. **If "lock seeds" is on, should the printed footer date also lock,
    or should it always show today's date?** Default: date is always
    today; only the maze layout locks.

**Open scope questions Codex flagged that need product input:**
24. **Pixel-font fidelity for "Item Hopper" / "Furnace" labels.** PDF
    page 3 uses Minecraft pixel typography. We default to Helvetica-Bold
    + biome-anchored description ("Hopper", "Furnace") to honor the
    no-custom-fonts constraint. Would you accept that, or is the pixel
    font load-bearing?
25. **Custom non-canonical assembly authoring (e.g., a heart shape for
    Valentine's).** We default to no — the catalog is the only authoring
    surface in v1. Confirm or push back.

### 5.2 Hard scope risks (the apex predators)

The single highest-cost mistake on this product would be drifting toward a
Minecraft level editor. The three knobs that would cause that drift, in
order of likelihood:

1. **Free-form maze authoring / hand-editing of walls.** Hard-no, ever.
   The fix when Andrew dislikes a maze is the re-roll button.
2. **Custom non-canonical assembly authoring.** Hard-no, ever.
3. **Uncurated item palettes** (Andrew picking any block as a maze
   collectible). Curate to per-biome whitelists.

If pressure to relax any of these surfaces during implementation, route it
through Andrew first, not through the feature build.

### 5.3 Trade-offs against existing CLAUDE.md (consolidated)

| Constraint | Resolution |
|---|---|
| No auth, DB, analytics | Complies. All state local or in-memory. |
| No server-side PDF generation | Complies. Browser-side `pdf-lib`, dynamically imported. |
| No persistent server state | Complies. localStorage + JSON file is the persistence boundary. |
| No env vars on the page | Complies. Email route keeps `RESEND_API_KEY`; this plan adds none. |
| No A4 mode | Complies. Letter portrait only, hard-coded. |
| Wiki proxy allowlist tight | Complies. Build-time scraping bypasses proxy; runtime serves static thumbnails. |
| Polite User-Agent preserved | Complies. `DavisPuzzleWeb/1.0 (OT therapy worksheets)` on both runtime and build. |
| Pixel Puzzle product unchanged | Complies. Tab strip preserves `/` route; catalog v2 is back-compat with v1 reads; no Pixel Puzzle file edits. |
| No custom asset/fonts | **Scoped concession.** Helvetica-Bold replaces PDF page 3's pixel-font labels. Visual departure is deliberate. Revisit only on Andrew's explicit request. |
| Exactly four pages | **Scoping clarification.** This is the Pixel Puzzle PDF contract; Maze Hunt is a different PDF class with one worksheet per page. CLAUDE.md should be updated when Epic 3 lands to scope this rule. |
| No 5th page | **Conditional concession.** Maze Hunt's split-page toggle (Epic 3) and pre-cut mode (deferred) both add pages. The 5th-page rule, like the 4-page rule, is Pixel Puzzle-scoped. |
| No query-string deep links | Complies. v1 Maze Hunt uses no `?...` parameters. |
| Browser-only generation | Complies. |
| `pdf-lib` dynamically imported on Generate | Complies. Maze Hunt orchestrator imports the same way. |

### 5.4 Sequencing dependencies (visual)

```
Epic 1: Catalog (F3) + Maze (F2) + Theme bundle data (F1 data only) ─┐
                                                                      ├─→ Epic 2: Collectibles (F4) + Assemblies (F5) ─→ Epic 3: Objectives (F6) + Print (F7) ─→ Epic 4: Selector UI (F1 UI only) ─→ Epic 5: Presets (F8)
```

- F3 unblocks F4 (item refs), F5 (assembly cells + cutouts), and F1's
  theme bundle data (boss/centerpiece + collectible refs per theme).
- F2 is independent of F3; both ship in Epic 1 in parallel.
- **F1's data layer (theme bundle JSON + pluralization fields)** ships in
  Epic 1 alongside the catalog and maze code. Authoring the theme JSON
  in Epic 1 is the only way to validate every asset reference against
  the freshly-built `items.json` before any UI exists — Codex flagged
  the original "F1 ships entirely in Epic 4" framing as a dependency
  inversion (F6 needs theme phrasing slots, but F6 is in Epic 3).
- F4 needs F2 (maze grid) and F3 (item refs).
- F5 needs F3 (cutout + slot items, including wet/dry sponge variants).
- F6 needs F1's theme phrasing slots (now landed in Epic 1) and F4's
  `PlacementResult.placementsByItem` for count tokens.
- F7 orchestrates F2 + F4 + F5 + F6 onto a Letter portrait page,
  computing the `AnswerWalk` (entrance → all collectibles → exit, with
  off-path detours) from F2's `solutionPath` + F4's placements.
- **F1's UI layer** ships in Epic 4 — selector cards, tab strip,
  difficulty pills. By that point the data and every consumer already
  exist; Epic 4 is purely "open the front door."
- F8 needs all of F1–F7 functioning and exposing seedable, schema-stable
  configurations.

This dependency graph is why Epic 4 (the front-door UI) ships *after*
Epics 1–3 (the editor internals plus the F1 data layer): the front door
is meaningless until the editor behind it produces real worksheets, and
the F1 data layer must exist earlier to validate asset references and
to feed F6's phrasing templates.

---

## 6. v1.1 and beyond (deferrals listed once, not scattered)

Things deliberately NOT in v1, sorted by likelihood Andrew asks for them.

**High-likelihood follow-ups:**
- Multi-worksheet batch print (3 mazes, same difficulty, one PDF) — Epic 3.
- Pre-cut mode for younger / motor-impaired kids — Epic 2.
- Per-preset thumbnails — Epic 5.
- Assemblies 7–9 (Iron Golem, Beacon Pyramid, End Portal Frame) — Epic 2.
- 5th, 6th biome theme — Epic 4.
- Reading-level dial on objectives — Epic 3.

**Medium-likelihood follow-ups:**
- Sequenced collection with numbered-sprite affordance — Epic 2.
- Off-center / corner boss placement — Epic 1.
- Region constraints on collectibles ("always near center") — Epic 2.
- Per-slot item override on assemblies — Epic 2.
- Per-objective drag-to-reorder — Epic 3.

**Low-likelihood / explicitly hard-no:**
- Free-form maze wall editing.
- Custom non-canonical assembly authoring.
- Custom Minecraft pixel font.
- Per-child accounts / longitudinal tracking.
- Cross-device cloud sync of presets.
- A4 / Legal / custom paper sizes.
- Conditional / compound objectives.
- Multilingual support.
- Andrew's name / clinic name in footer (PII concern).

If any of these is requested, route it through Andrew (or, for the hard-nos,
through an explicit product decision conversation) before re-scoping.

---

## 7. Cross-feature contracts (appendix)

This appendix pins the data shapes that flow between features so an
implementer doesn't have to invent them from the per-feature artifacts. If
a per-feature artifact disagrees with this appendix, **this appendix wins**
and the artifact is the one that needs an update.

### 7.1 Identifier conventions

- **Catalog asset IDs** (used in `MazeHuntTheme`, assemblies, placements,
  presets) are the existing `canonicalName` field from `lib/catalog.ts` —
  Title_Snake (e.g., `Apple`, `End_Crystal`, `Wet_Sponge`, `Soul_Sand`,
  `Wither_Skeleton_Skull`, `Ender_Dragon`). Do **not** use lowercase
  variants (`ender_crystal`, `wet_sponge`) anywhere in code or data — the
  per-feature artifacts mix conventions, the resolved standard is
  Title_Snake.
- **Maze coordinates** use the field names `x` (column) and `y` (row),
  not `r` and `c`. Origin is top-left of the bounding box. Cells are
  whole integers; pt conversion happens only inside the renderer.
- **Theme IDs** are lowercase kebab-case slugs: `end-island`, `nether`,
  `ocean-monument`. Stable across releases.
- **Assembly IDs** are lowercase snake_case: `obsidian_pillar`,
  `wither_summon`, `hopper_furnace`.

### 7.2 The `MazeGrid` shape (F2 → F4 / F7)

```ts
export interface MazeCell { x: number; y: number; }

export interface WallSegment {
  x1: number; y1: number; x2: number; y2: number; // cell-grid units
  kind: "boundary" | "interior";
}

export interface MazeGrid {
  silhouette: { kind: "circle" | "star4" | "rectangle"; cellsAcross: number };
  cellsAcross: number;
  cellsDown: number;

  inShape: boolean[][];           // [y][x]
  walls: WallSegment[];
  entrance: MazeCell;
  exit: MazeCell;

  // The unique entrance→exit walk in a perfect maze.
  solutionPath: MazeCell[];

  // Per-cell distance from entrance; -1 for out-of-shape cells.
  distanceFromEntrance: number[][];

  // Cells with exactly one open neighbor — used by F4 to find off-path
  // detours.
  deadEnds: MazeCell[];

  // Branch metadata for off-path placement: keyed by index into
  // solutionPath, value is the list of branch cells with their depth.
  // F2 may compute this lazily via getBranches() rather than eagerly;
  // F4 must accept either form.
  branches?: Array<{
    rootIndex: number;            // index into solutionPath
    cells: Array<{ cell: MazeCell; depth: number }>;
  }>;

  // 6-char base32; printed in the page footer.
  seed: string;
}
```

### 7.3 The `PlacementResult` shape (F4 → F6 / F7)

```ts
export interface Placement { cell: MazeCell; itemRef: string; } // itemRef = canonicalName

export type PlacementResult =
  | {
      ok: true;
      // Flat list, ordered for rendering.
      placements: Placement[];
      // Grouped for objective phrasing (F6 reads this for "3 wither
      // skulls" / "4 soul sand" prompts on page 2).
      placementsByItem: Record<string, Placement[]>;
      // Total count, derived; equals placements.length.
      totalCount: number;
    }
  | {
      ok: false;
      reason:
        | "infeasible-not-enough-off-path"
        | "infeasible-spacing-too-tight"
        | "infeasible-type-constraint";
    };
```

### 7.4 The `AnswerWalk` shape (F2 + F4 → F7)

The print layout's answer-key path is **not** the same as `solutionPath`.
`solutionPath` is entrance→exit only; the `AnswerWalk` is entrance →
all collectibles → exit, with off-path detours included. F2 emits
`solutionPath`; the orchestrator (F7) computes the `AnswerWalk` by
walking `solutionPath` and inserting branch detours wherever F4 placed
an off-path collectible.

```ts
export interface AnswerWalkSegment { from: MazeCell; to: MazeCell; }

export interface AnswerWalk {
  // Ordered list of cells the pencil visits, in order, including
  // backtracks through branches (cells may repeat).
  cells: MazeCell[];
  // Cells where collectibles are picked up, with the placement index.
  collectibleHits: Array<{ pathIndex: number; itemRef: string }>;
  // Pre-computed segments for the renderer.
  segments: AnswerWalkSegment[];
  // Entry / exit arrows.
  entryArrow: { cell: MazeCell; direction: "N" | "S" | "E" | "W" };
  exitArrow:  { cell: MazeCell; direction: "N" | "S" | "E" | "W" };
}
```

### 7.5 The `Assembly` shape and the cutout-count rule

```ts
type ItemRef = string; // canonicalName

type Slot =
  | { kind: "blank" }
  | { kind: "decorative"; item: ItemRef }
  | {
      kind: "paste";
      defaultItem: ItemRef;        // what fills this in default config
      answerItem: ItemRef;         // shown in answer key (may differ — state change)
      positionalConstraint?: boolean;
    };

interface CutoutSpec {
  item: ItemRef;
  count: number;                   // FIXED at the assembly level — not derived from F4
  borderStyle: "thick";            // v1: one style only
}

export interface Assembly {
  assemblyId: string;
  displayName: string;
  description: string;             // Helvetica-Bold biome-anchored text
  gridShape: Slot[][];
  cutoutPanel: CutoutSpec[];       // explicit per-assembly count
  biomeAffinity: string[];
  scalingAxis: "size" | "count" | "shape" | "none";
  scalingPresets?: { small: number; medium: number; large: number };
  answerKeyDefault: "pre-pasted" | "blank";
  hasStateChange: boolean;
}
```

**The cutout-count rule, stated once:** the cutout panel has whatever
count the `Assembly` declares. F4's `PlacementResult.totalCount` does
**not** drive cutout count. PDF page 1 is the proof: 6 ender crystals on
the maze, 5 ladder cutouts in the panel, deliberate.

What F4 *does* drive is:
- The number of collectible icons rendered inside the maze.
- The count token Feature 6 inserts into the navigate-slot prompt
  ("Collect {count} ender crystals." → "Collect 6 ender crystals.").

These two consume the same `PlacementResult.totalCount`; the assembly
cutout panel is independent.

### 7.6 Theme bundle shape (Epic 1 owns the data, Epic 4 owns the UI)

The full `MazeHuntTheme` TypeScript shape lives in
`02-feature-activity-selector.md` §6. It is shipped as static JSON in
`public/maze-hunt-themes.json` during Epic 1 (alongside the catalog and
maze code), so every theme's asset references can be validated against
the freshly-built `items.json` before any UI is written. Epic 4 only
adds the selector component; the data is already on disk.

### 7.7 Preset seed model and determinism levels

Two distinct levels of "same":

- **Clinically equivalent.** Same theme, same difficulty bundle, same
  collectible counts, same assembly. Maze layout may differ from one
  Generate to the next, by design — Andrew often wants a fresh maze
  for each kid in a group from the same loaded preset.
- **Byte-identical.** Same maze layout, same collectible positions,
  same PDF bytes. Achievable only when the preset has `lockSeeds: true`
  AND the renderer freezes everything that varies across runs:
  `generatedAt` field in the catalog, the footer date, the PDF metadata
  `CreationDate` / `ModDate`, the renderer version string, and the seed
  in every RNG.

The default preset shape (see `09-feature-preset-library.md` §3.2)
saves the **config seed** (drives deterministic things like assembly
slot order) but generates a fresh **run seed** on every Generate. The
`Lock seeds` checkbox writes the run seed into the preset and
additionally freezes the footer date to `lastPrintedAt`. Without that
checkbox, the footer date is always today.

### 7.8 `pdf-lib` 1.17.1 specifics (the version actually installed)

- `pdf-lib`: `^1.17.1` (per `package.json`). Not 3.x as some artifacts
  imply.
- `page.drawSvgPath(path, options)` accepts: `x`, `y`, `scale`, `rotate`,
  `borderWidth`, `color`, `opacity`, `borderColor`, **`borderDashArray`**
  (not `dashArray`), `borderDashPhase`, `borderLineCap` (one of the
  `LineCapStyle` enum values), `borderOpacity`, `blendMode`. Confirmed
  by reading `node_modules/pdf-lib/cjs/api/PDFPage.js`.
- For the answer-key dashed-with-chevrons path: `borderDashArray: [6, 4]`,
  `borderDashPhase: 0`, `borderLineCap: LineCapStyle.Round`, plus a
  separate pass that walks the maze cell sequence and stamps small
  chevron triangles at every 4th cell (each chevron is its own small
  `drawSvgPath` triangle — `pdf-lib` has no native chevron primitive).
- Pixel Puzzle product currently uses `drawLine`, `drawText`, and
  `drawRectangle`. Maze Hunt adds `drawSvgPath` and `embedPng` (for
  block / entity thumbnails) but keeps the dynamic-import pattern from
  `app/page.tsx`.

### 7.9 Build-time image dependencies (added in Epic 1)

- `sharp` (`^0.33.x` or current) — `devDependency` only. Used in
  `scripts/build-catalog.ts` to resample entity portraits to the
  `defaultDisplaySize` (160–200 px) declared in each entity's catalog
  entry. Never shipped to the client.
- `gifuct-js` (or equivalent, ~6KB MIT) — `devDependency` only. Used to
  extract frame 0 from animated entity GIFs (Ender Dragon, Elder
  Guardian, Allay, Warden, Blaze, Prismarine block) and re-encode as
  static PNG. `pdf-lib` cannot embed GIFs, so the static frame is the
  only viable artifact.

Both deps are install-time; neither bloats the production bundle.

### 7.10 localStorage two-tier preset write contract

Two keys:
- `davis.mazehunt.preset.index` — JSON array of `{ id, name,
  difficultyDescriptor, lastPrintedAt }`. Read on every preset list
  render.
- `davis.mazehunt.preset.{id}` — JSON of the full `MazeHuntPreset`.

Write order on Save:
1. Write `davis.mazehunt.preset.{id}` first.
2. Read `davis.mazehunt.preset.index`, splice in the new entry, write
   it back.

Write order on Delete (reverse, also non-atomic):
1. Read the index, remove the entry, write it back.
2. Remove `davis.mazehunt.preset.{id}`.

If a tab is killed mid-write, the index may briefly disagree with the
keys. On load, treat the index as authoritative and lazily reconcile by
filtering out index entries whose key is missing. Don't try to
reconstruct the index from scattered keys — too brittle.

---

## 8. Reference documents

All under `web/planning/maze-hunts/`:

- `01-pdf-analysis.md` — foundational PDF read; module taxonomy; clinical-
  channel analysis; the 8 candidate features.
- `02-feature-activity-selector.md` — Epic 4.
- `03-feature-maze-generator.md` — Epic 1 (maze portion).
- `04-feature-catalog-expansion.md` — Epic 1 (catalog portion).
- `05-feature-collectible-placement.md` — Epic 2 (collectibles).
- `06-feature-assembly-template.md` — Epic 2 (assemblies).
- `07-feature-objective-composer.md` — Epic 3 (objectives).
- `08-feature-print-layout.md` — Epic 3 (print).
- `09-feature-preset-library.md` — Epic 5.

Plus existing repo references:

- `web/CLAUDE.md` — the operating constraints this plan inherits.
- `web/lib/catalog.ts` — schema being bumped from v1 to v2.
- `web/scripts/build-catalog.ts` — scraping pipeline being extended.
- `web/app/page.tsx` — the single-page UI gaining a tab strip.
- `web/lib/pdf/` — existing pixel-puzzle renderers; layout primitives are
  reused, the 4-page contract is not.
- `/Users/paulmikulskis/Development/Davis-Puzzle/minecraft-maze-hunts.pdf` —
  the source-of-truth deliverable Andrew handed us.

---

## 9. Final pre-implementation checklist

Before the first line of Epic 1 code:

1. Codex CLI eagle-eyed review of this plan — **complete, folded in**
   (5 critical / 5 important / 4 nice-to-have findings). See git log on
   this file for the fold-in commit.
2. Andrew sign-off on the §5.1 open questions list. The blocking subset
   is questions 1, 2, 4, 10, and 11 (activity name, theme count, single-
   solution maze contract, assembly catalog scope, cutout-vs-collectible
   count rule).
3. A new `feature/maze-hunt-foundation` branch off `main` with this `plan.md`
   committed alongside `web/planning/maze-hunts/`.
4. The roadmap.json (existing local artifact) updated with the new epic
   list, status `pending`, motivation lifted from the relevant section
   here.
5. CLAUDE.md amendments ready to land alongside Epic 1: scope the
   "exactly four pages" and "no 5th page" rules to Pixel Puzzle; clarify
   that "no custom asset/fonts" means no custom **font files**
   (wiki-sourced static art is fine); document the catalog v2 schema bump
   as a deliberate exception with the validator-update atomicity
   requirement.

After that, Epic 1 begins.

---

## 10. UX-affordance refinements (post-`ux-affordance-review` pass)

This section records the output of a surgical UX-affordance pass applied after
the plan was drafted. Each item references an existing section by number. Apply
the proposed edit in-place when implementing that section's epic — these are not
new tasks, they are constraints that sharpen work already planned. If a
refinement conflicts with a product decision made during Andrew's Q&A (§5.1),
the Andrew answer wins.

---

### R1 — Epic 4 §4.4: Default difficulty pre-selected on card load

**Current language (§4.4, "What ships"):** "Difficulty pills cycle on tap; each
theme carries its own `difficulties: Record<DifficultyPreset,
MazeHuntDifficultyDefaults>`"

**Proposed edit:** Add after the difficulty-pills sentence: "Each theme must
render with a pre-selected default difficulty so the 'Open editor' CTA is
actionable from the moment the card loads, with no required tap first. The
per-theme `difficulties` record should include a `default: DifficultyPreset`
field; the card renders that pill as selected on mount. Tapping a different pill
switches the selection; tapping the already-selected pill does nothing. The 'Open
editor' CTA must never be disabled or require pill interaction to activate."

**Anchored user moment:** Andrew, on a Chromebook, opens the page cold with 2
minutes before a session. He clicks Maze Hunt, sees End Island, clicks Open
editor directly (he uses Medium every time). Under the current spec he is forced
to confirm a difficulty pill before the CTA is meaningful — one extra interaction
on every cold start, and the CTA gives no feedback about what difficulty it will
open with unless a pill is already selected.

**Why not already in the plan:** The pitfall note says "editor opens ready to
print" but the pill interaction contract does not state which pill is selected at
card-load time. Omission, not disagreement.

---

### R2 — Epic 5 §4.5: Unsaved-editor-state guard on preset Load

**Current language (§4.5, "What ships"):** "Load" is listed as a CRUD action
alongside Save, Rename, and Delete. Delete has an explicit "with confirm" note.
Load has no guard mentioned.

**Proposed edit:** Add to the `PresetLibrary.tsx` description: "If the current
editor has been modified since last Generate (dirty state), Load must prompt:
'Loading this preset will replace your current configuration. Continue?' with
Load / Cancel. This is the only non-trivial confirmation in the preset library;
it should not cry wolf on other actions."

**Anchored user moment:** Andrew configures a custom Nether variant — changes
collectible count, tweaks an objective line. He opens the preset library to check
an old preset's name. He accidentally taps Load instead of the preset name row.
His customized configuration is silently replaced. He does not notice until he
prints and the worksheet looks wrong. At that point he cannot recover because
presets are the only persistence surface.

**Why not already in the plan:** The pitfalls section covers `localStorage`
clearing, schema drift, and algorithm-version pinning. The in-session state loss
on Load is the highest-cost accidental action in Epic 5 and is not named
anywhere.

---

### R3 — Epic 2 §4.2: Re-roll buttons require visual distinction beyond label text

**Current language (§4.2, pitfalls):** "Re-roll semantics ambiguity. Two
distinct buttons: 'Re-roll layout' (cheap, keeps maze) vs. 'Re-roll maze'
(resets placement). Label both unambiguously."

**Proposed edit:** Add a constraint after the labeling note: "'Re-roll layout'
and 'Re-roll maze' must be visually differentiated beyond label text — for
example, different button weight (secondary vs. ghost), a different icon (shuffle
vs. refresh), or spatial separation so they cannot be hit by adjacent taps. The
cost asymmetry is real: 'Re-roll layout' is cheap and reversible; 'Re-roll maze'
discards the maze grid and resets placement (10–30s of positioning work). Visual
weight should reflect that asymmetry."

**Anchored user moment:** Andrew taps Re-roll to try a different collectible
arrangement on a maze he likes. The two buttons are side by side at equal visual
weight. He taps the wrong one. His maze disappears and a new one is generated.
He has no undo. He must regenerate and hope the new maze is similar enough.

**Why not already in the plan:** The plan correctly names the labeling problem
but stops at copy. At real interaction speed on a Chromebook trackpad or touch
surface, label-only differentiation between adjacent same-weight buttons is not
a sufficient affordance signal.

---

### R4 — Epic 3 §4.3: Confirm Download must be in viewport after the last stepper step

**Current language (§4.3, "How it comes together"):** "Click Generate → preview
shows a stepper (Summary, Answer key, Coordinate-style maze, Collectibles,
Cutouts) → Confirm Download writes `<theme_id>_maze_<seed>.pdf` to disk."
No scroll/visibility contract specified.

**Proposed edit:** Add a layout constraint: "After the user advances to the last
stepper step, Confirm Download must be visible without vertical scrolling at a
768px viewport height. If the stepper body is taller than the viewport, Confirm
Download should be sticky-positioned at the bottom of the stepper container
rather than placed below it. This matches the existing Pixel Puzzle visualizer
convention; preserve it."

**Anchored user moment:** Andrew reviews all four stepper panels on a modest
Chromebook screen. He clicks through to the last panel. He looks for Confirm
Download and cannot see it — stepper content pushed it below the fold. He
scrolls, overshoots, scrolls back. Small annoyance on every generate cycle;
a disproportionate hesitation when he is in front of a class.

**Why not already in the plan:** The stepper flow is described at the feature
level; the scroll/visibility contract for Confirm Download is unspecified. The
Pixel Puzzle product solves this already; the plan should explicitly carry that
pattern forward rather than leaving it as an implementer judgment call.

---

### R5 — Epic 3 §4.3: Objective count-mismatch badge must be impossible to miss before printing

**Current language (§4.3, pitfalls):** "Override wins, badge the mismatch.
Confirm with Andrew before ship."

**Proposed edit:** Promote the badge from passive annotation to active warning:
"When a mismatch exists between an override text's count token and the live
placement count, the badge must be visually prominent — an amber inline warning
directly on the objective line AND a second callout proximate to the Generate
button ('1 objective has a count mismatch — review before printing'). The badge
should not block Generate (Andrew may have intentional overrides) but must be
impossible to overlook before the download happens."

**Anchored user moment:** Andrew writes "Find 8 ender crystals" in the objective
override. He later adjusts placement to 6. The badge is a small indicator on the
objective line. He hits Generate, hits Confirm Download, and prints. He hands
the sheet to a kid. The kid finds all 6 crystals, reads "Find 8", and reports
failure. The mismatch became a clinical error on a physical worksheet that
Andrew cannot easily correct mid-session.

**Why not already in the plan:** The plan specifies that override wins and the
mismatch is badged, but does not specify badge prominence or a secondary callout
at Generate time. The clinical consequence of a silent mismatch on a printed
artifact is higher than a typical web-app validation miss.

---

### R6 — Epic 4 §4.4: Theme card difficulty pills must meet 44px tap target on Chromebook touch

**Current language (§4.4, "What ships"):** "3-pill difficulty selector (Easy /
Medium / Hard)" — no tap-target size specified.

**Proposed edit:** Add a layout constraint: "Each difficulty pill must present a
minimum 44px interactive tap target height (`min-height: 44px; padding: 0 12px`).
Adjacent pills must not be closer than 8px on the tap surface. On Chromebook the
user may be touch-first; a pill that is visually 24px tall with a matching
touch-active area will be frequently missed, causing the user to open the editor
with the wrong difficulty without noticing."

**Anchored user moment:** Andrew taps "Hard" on the Ocean Monument card on a
Chromebook touchscreen. The pill is 24px tall. His tap lands in the gap and the
selection does not change. He does not notice, and opens the editor with Medium
defaults. He generates a worksheet that is easier than intended for the group he
had in mind. The error is invisible until he compares the printed difficulty
descriptor to his session notes.

**Why not already in the plan:** The plan does not name the Chromebook as a touch
surface anywhere in the UI spec — only in CLAUDE.md §1. Tap-target discipline is
absent from the card spec entirely.

---

### R7 — Epic 1 §4.1 and Epic 3 §4.3: Generate and Re-roll must show a loading signal

**Current language:** Epic 1's "How it comes together" and Epic 3's "How it
comes together" both describe the Generate action without specifying any loading
state during PDF construction.

**Proposed edit:** Add to both sections' "How it comes together" text: "Generate
must show a loading signal (button text changes to 'Generating...' plus disabled
state, or a spinner adjacent to the button) from click until the PDF object URL
is ready. On a slower client, `pdf-lib` construction takes 1–3 seconds; silence
during that window reads as a broken app. The Pixel Puzzle product already
implements this pattern in `app/page.tsx`; carry it forward to Maze Hunt without
modifying the existing behavior."

**Anchored user moment:** Andrew hits Generate on a school Chromebook running
5 tabs. PDF construction takes 2.5 seconds. The button stays in its default
state. Andrew assumes the tap did not register and taps again. A second
generation starts. The first finishes and is immediately replaced. The preview
flickers. Andrew is unsure whether he is looking at the first or second result.

**Why not already in the plan:** The plan inherits Pixel Puzzle conventions by
reference but does not explicitly extend the loading-state pattern to Maze Hunt's
Generate flow. An implementer reading the plan as spec may omit it.

---

### R8 — Epic 3 §4.3: B&W toggle must carry more visual weight than split-page toggle

**Current language (§4.3, "What ships"):** B&W safety toggle and split-page
toggle are described as equivalent "single switch in editor" controls in the same
paragraph.

**Proposed edit:** Add a visual-hierarchy note: "B&W toggle and split-page toggle
must not be presented at equal visual weight. B&W toggle is session-critical:
omitting it on a school B&W laser produces a red-that-becomes-gray answer-key
path nearly invisible against black maze walls. Split-page toggle is an
infrequent layout preference. B&W toggle should render as a prominently labeled
top-level control with a short helper text ('Recommended for school printers');
split-page toggle may be secondary or collapsed. Consider surfacing the current
B&W toggle state in the stepper summary step so Andrew sees it before
Confirming."

**Anchored user moment:** Andrew uses the app for the first time. He sees two
checkboxes of equal weight: "Black and white safe" and "Split into two pages".
He ignores both (both default off). He prints on the school B&W laser. The
answer-key path is an illegible gray smear against the maze walls. He does not
know which checkbox would have fixed it, and next session he is unsure whether
to check one or both.

**Why not already in the plan:** Both toggles are documented in the same
paragraph without any relative-importance signal. The behavioral hierarchy is
unexamined at the presentation level.

---

### Cut: 4 candidates ranked below the friction threshold

- **Epic 3 "click-to-edit" objective language implies mouse.** On Andrew's
  Chromebook (trackpad-primary with occasional touch), this is a minor concern.
  Real friction only on pure-touch devices not described in the product
  constraints. Cut.
- **Epic 4 "Open editor" CTA visual hierarchy vs. difficulty pills inside the
  card.** Real, but fully subsumed by R6: once tap-target sizing forces proper
  layout discipline on the card, the CTA hierarchy problem resolves as a
  byproduct. Cut to avoid duplication.
- **Epic 5 "Lock-seeds" tooltip discoverability.** The plan already calls this
  out explicitly in pitfalls ("Lock-seeds discoverability... needs a tooltip").
  Duplicating it here adds noise without signal. Cut.
- **Epic 1 scratch maze page error state for over-specified cell counts.** The
  pitfall note on the pencil-precision band already says "surfaces a 'reduced
  for print safety' note." The gap is only where in the UI it appears — a
  low-friction implementation detail, not a missing affordance. Cut.

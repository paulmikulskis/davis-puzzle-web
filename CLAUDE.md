# CLAUDE.md

This file is the operating guide for future agents working in this repository.
Read it before changing code.

## Project Summary

This repository is the browser-deployed web port of Andrew Davis's Minecraft
Pixel Art Puzzle generator. Andrew is an occupational therapist who uses
Minecraft inventory textures to create 16x16 pixel-art coloring worksheets for
therapy sessions. The worksheets train hand-eye coordination, visual-spatial
reasoning, focus stamina, and fine motor control while feeling like play.

The canonical Python reference still lives next door:

```text
/Users/paulmikulskis/Development/Davis-Puzzle/minecraft-pixel-puzzle/
  plan.md
  SKILL.md
  make_puzzle.py
```

This web app lives here:

```text
/Users/paulmikulskis/Development/Davis-Puzzle/web/
```

The deployed app is:

```text
https://davis-puzzle-web.vercel.app
```

The GitHub repo is:

```text
https://github.com/paulmikulskis/davis-puzzle-web
```

The app is intentionally tiny and stateless. It has one page, one slider, one
Generate action, one preview stepper, one Confirm download action, and one wiki
proxy route. The user types a Minecraft item name, the browser fetches and
decodes the 16x16 inventory icon, builds a 4-page PDF in the browser, previews
the deliverables, and downloads the PDF locally only after confirmation.

Last verified production state:

```text
Date: 2026-05-08
Stable URL: https://davis-puzzle-web.vercel.app
Git commit: 913b363 Add puzzle preview visualizer
Vercel scope: paulmikulskis-projects
Vercel project: davis-puzzle-web
```

## North Star And Value

The north star is a classroom-safe utility, not a platform. Andrew should be
able to open the URL on a Chromebook, type a Minecraft item, review the
deliverables, confirm, and leave with a printable PDF. Nothing about the app
should require setup, accounts, storage, configuration, or an explanation of
software infrastructure.

The therapeutic value is the reason the implementation is strict:

- The 16x16 grid maps directly to Minecraft inventory textures and to the OT
  worksheet format.
- Coordinate labels train visual-spatial mapping and sustained attention.
- The color-by-number version lowers cognitive load for younger or newer kids.
- The advanced coordinate version keeps the same image but increases planning
  and lookup demand.
- The cover prompts support prediction, reflection, and task persistence.

Treat layout parity, metadata, and predictable download behavior as product
features. They are not incidental implementation details.

## Non-Negotiable Product Constraints

- No auth.
- No database.
- No analytics.
- No server-side PDF generation.
- No persistent server state.
- No cache layer.
- No env vars required by the app.
- No custom asset/fonts for PDF rendering.
- No A4 mode.
- No 5th page.
- No query-string deep links unless explicitly requested later.
- Do not mutate the Python reference folder.

If a future change seems to require violating one of these constraints, stop and
make that tradeoff explicit before implementing it.

## Current Stack

- Next.js App Router, TypeScript.
- React client component for the main page.
- Tailwind v4 CSS.
- `pdf-lib` for browser-side PDF generation.
- Canvas API for browser-side PNG decode/resample.
- Custom TypeScript median-cut-style palette extraction.
- Vercel production deployment.
- `pnpm` package manager.

## Repository Map

```text
app/
  page.tsx
    Client component. Owns the item form, max-colors slider, status messages,
    friendly errors, generated puzzle state, and confirmed PDF download trigger.

  PuzzleVisualizer.tsx
    Client component. Owns the post-Generate preview stepper: summary, answer
    key, coordinate-coloring preview, color-by-number preview, and Confirm
    download button.

  layout.tsx
    Metadata and global layout.

  globals.css
    Minimal global CSS and design tokens.

  api/wiki/route.ts
    Server route handler. Proxies minecraft.wiki image/article responses with
    a polite User-Agent and no caching.

lib/
  canonicalize.ts
    Matches Python name normalization: spaces/underscores/hyphens become
    title-cased underscore tokens.

  errors.ts
    Small typed error wrapper for translating failures into user-facing copy.

  fetchTexture.ts
    Browser-side item resolution. Tries direct wiki filename patterns first,
    then scrapes the article HTML for an Invicon image reference.

  palette.ts
    Canvas decode, 16x16 resample, opaque pixel extraction, cell labels,
    palette clustering, and deterministic ordering.

  pdf.ts
    Creates the PDF document, embeds standard fonts, applies metadata, and
    calls the four page renderers.

  pdf/
    cover.ts
    reference.ts
    colorByNumber.ts
    coordinate.ts
    grid.ts
    keyEntry.ts
    ReportLab-equivalent PDF rendering helpers and page renderers.

public/
  favicon.svg
```

## Core User Flow

1. User opens `/`.
2. User enters a Minecraft item name, for example `cooked salmon`.
3. User selects max colors on the range slider, default `8`, min `4`, max `12`.
4. User clicks Generate.
5. Browser canonicalizes the item name, for example `Cooked_Salmon`.
6. Browser calls the local proxy route to fetch the wiki texture.
7. Browser decodes the PNG into a 16x16 canvas.
8. Browser extracts opaque cells and groups them into a palette.
9. Browser dynamically imports `pdf-lib`.
10. Browser builds a 4-page Letter PDF and stores its object URL in state.
11. UI displays a preview stepper below the form.
12. User reviews the summary, answer key, advanced coordinate version, and
    simplified numbered version.
13. User clicks Confirm download.
14. Browser downloads `<canonical_lowercase>_puzzle.pdf`.

## Runtime Mechanics And Side Effects

The app has three important runtime phases:

1. Fetch phase:
   The browser calls `/api/wiki`, and the route handler makes a no-store
   upstream request to `minecraft.wiki` with the project User-Agent. The server
   passes bytes/HTML through but never stores them.

2. Generate phase:
   The browser creates a texture `Blob`, a texture object URL, a 16x16
   `ImageData`, a palette, a PDF byte array, a PDF `Blob`, and a PDF object URL.
   These are kept in React state as a `GeneratedPuzzle`.

3. Confirm phase:
   The browser creates a temporary anchor, points it at the PDF object URL, and
   programmatically clicks it. That is the only intentional download side
   effect.

Object URL lifecycle matters:

- Texture and PDF object URLs must remain alive while the preview is visible.
- If generation fails, any partially created object URLs are revoked.
- When a generated puzzle is replaced or the page unmounts, the previous object
  URLs are revoked.
- Do not synchronously revoke the PDF object URL immediately after Confirm;
  Safari can abort the download.

The server route's only side effect is outbound wiki traffic. It must never
write files, cache payloads, log user activity, generate PDFs, or persist state.

## Wiki Proxy Contract

The only server route is:

```text
GET /api/wiki?kind=image&path=...
GET /api/wiki?kind=article&path=...
```

Implementation file:

```text
app/api/wiki/route.ts
```

Rules:

- Runtime is the default Node runtime.
- Upstream fetches use `cache: "no-store"`.
- Responses set `Cache-Control: no-store`.
- User-Agent must remain:

```text
DavisPuzzleWeb/1.0 (OT therapy worksheets)
```

- Image allowlist must allow parentheses:

```ts
/^Invicon_[A-Za-z0-9_()]+\.png$/
```

- Article allowlist must allow parentheses:

```ts
/^[A-Za-z0-9_()]+$/
```

- Image upstream URL:

```text
https://minecraft.wiki/images/<encoded filename>
```

- Article upstream URL:

```text
https://minecraft.wiki/w/<encoded article path>
```

Do not proxy arbitrary URLs. The allowlist is part of the safety model.

## Texture Resolution Contract

Implementation file:

```text
lib/fetchTexture.ts
```

For a canonical item name, try these filenames in order:

```text
Invicon_<Canonical>.png
Invicon_Raw_<Canonical>.png
Invicon_Cooked_<Canonical>.png
```

If all three are 404, fetch the article HTML and scrape with this regex:

```ts
/\/images\/(?:thumb\/[^/]+\/[^/]+\/)?(Invicon_[A-Za-z0-9_]+\.png)/g
```

Then sort candidates by:

1. Filename contains canonical token, descending.
2. Filename length, ascending.
3. Regex order, ascending.

The scraped filename is then fetched through the same image proxy route.

Known examples:

- `apple` resolves to `Invicon_Apple.png`.
- `cooked salmon` resolves to `Invicon_Cooked_Salmon.png`.
- `diamond` resolves to `Invicon_Diamond.png`.
- `iron ingot` resolves to `Invicon_Iron_Ingot.png`.
- `pufferfish` resolves to `Invicon_Pufferfish.png`.

## Palette Contract

Implementation file:

```text
lib/palette.ts
```

Constants:

```ts
GRID_N = 16
COLUMNS = "ABCDEFGHIJKLMNOP"
ROWS = "abcdefghijklmnop"
ALPHA_THRESHOLD = 32
```

Opaque means `alpha >= 32`.

Cell labels are uppercase column plus lowercase row:

```text
pixel (3, 10) -> "Dk"
```

Pixel iteration order must remain row-major:

```ts
for y in 0..15:
  for x in 0..15:
```

Cells within a palette entry must be sorted in reading order:

```text
row a..p, then column A..P
```

Palette entries must be sorted by descending cell count. Ties are resolved by
first source-pixel index in this implementation.

If the decoded image is not exactly 16x16, draw it into a 16x16 canvas with:

```ts
ctx.imageSmoothingEnabled = false
ctx.drawImage(source, 0, 0, 16, 16)
```

Do not crop. Do not blur.

The web quantizer is intentionally not byte-identical to Pillow. The acceptance
bar is:

- Palette count matches the Python reference for the spot-check items.
- Opaque cell count matches the Python reference.
- Every opaque cell appears in exactly one palette entry.
- No transparent cell appears in a palette entry.

Important compatibility note:

`pufferfish` at max colors `8` should produce `145` opaque cells across `7`
colors. The Python/Pillow quantizer leaves one palette slot unused for that
texture. `lib/palette.ts` contains a narrow compatibility fallback for the
small split-blue-cluster shape that would otherwise produce 8 colors. Do not
remove that fallback unless you also rerun the full spot-check matrix and accept
the changed behavior deliberately.

## PDF Contract

Implementation files:

```text
lib/pdf.ts
lib/pdf/*.ts
```

Use `pdf-lib` only in the browser. It is dynamically imported by `app/page.tsx`
on Generate so first paint stays light.

Document properties:

```text
Page size: Letter, 612 x 792 pt
Fonts: Helvetica, Helvetica-Bold, Helvetica-Oblique
Title: "<Item Label> - Minecraft Pixel Art Puzzle"
Author: "Davis Puzzle Generator"
Subject: "Source texture: <source filename>"
```

There must be exactly four pages, in this order:

1. Cover sheet.
2. Facilitator answer/reference page.
3. Color-by-number worksheet.
4. Coordinate-coloring worksheet.

There is no fifth "Pasting by Number" page. The cover describes that workflow,
but the facilitator reuses the color-by-number output as the source for cut
tiles.

Page headings must match the Python reference:

```text
Minecraft Pixel Art Puzzles
<Item Label> (Hard) \u2014 Reference
<Item Label> (Color by Number)
<Item Label> (Coordinate Coloring)
```

The `\u2014` is an em dash. Avoid changing title text casually.

Cover prompts must remain verbatim:

```text
Based on the pixel colors, I think the image is
Now that I filled in half, I think the image is
Now that I filled it all in, the image is
```

Cover workflow headings/body must remain verbatim:

```text
1. Coordinate Coloring (Hard):
participant is given the coordinate coloring key and a blank Pixel Art Grid.

2. Color by Number:
facilitator uses simplified key and writes numbers on Pixel Art Grid.

3. Pasting by Number:
facilitator completes and cuts out puzzle tiles prior to session. Provide
participants with cut-out tiles and the standard / simplified coloring key.
```

Footer strings must remain aligned with the Python reference:

```text
Generated worksheet for: <Item Label>
Hard key: for each color, the listed cells should be filled with that color.
Color by Number: every cell shows a digit; match the digit to the key.
Hard: each cell label is column letter (A-P) + row letter (a-p), e.g. 'Dk' = column D, row k.
```

## Key PDF Layout Numbers

These numbers are copied from `make_puzzle.py` and should not be refactored into
config knobs.

Shared:

```text
PAGE_W = 612
PAGE_H = 792
GRID_N = 16
grid line width default = 0.5
label size default = 8.0
digit font size = max(6.0, cell * 0.55)
swatch border width = 0.4
key swatch size = 20.0
key text indent = 8.0
key line height = 11.5
key font size = 9.0
title font size = 22.0
title position = x 54, y PAGE_H - 56
footer position = x 54, y 28
footer font size = 8
footer gray = 0.45
```

Cover:

```text
cell = 17.0
gx = 60
gy = PAGE_H - 110
right column width = 220.0
right column gap = 24
name box height = 22
prompt font size = 9.5
workflow start y = 200
workflow x = 72
workflow max width = PAGE_W - 144
workflow line step = 12
workflow section gap = 8
```

Reference:

```text
cell = 16.0
gx = 60
gy = PAGE_H - 100
key gap = 24
right margin = 36
key heading font size = 11
first key top = gy - 14
inter-entry gap = 6.0
```

Color by Number:

```text
cell = 21.0
gx = 60
gy = PAGE_H - 100
key gap = 30
swatch size = 20.0
key heading font size = 11
key first decrement = 18
key row step = swatch_size + 8
bottom section offset = 40
name width = 200.0
prompt x = 290
prompt right margin = 36
prompt step = 32
```

Coordinate Coloring:

```text
cell = 16.0
gx = 60
gy = PAGE_H - 100
key gap = 24
right margin = 36
key heading font size = 11
first key top = gy - 14
inter-entry gap = 6.0
bottom section offset = 40
name width = 200.0
prompt x = 290
prompt right margin = 36
prompt step = 32
```

## UI Contract

The page should stay simple and direct:

- One text input.
- One range slider from 4 to 12 with visible live value.
- One Generate button.
- One generated preview stepper below the form.
- One Confirm download button after a puzzle has been generated.
- One concise help paragraph.
- One footer attribution.

Footer text in the app must read:

```text
Unofficial fan-made tool. Textures &copy; Mojang, sourced from minecraft.wiki.
```

The JSX currently renders the copyright symbol with `&copy;`, so the visible
page text shows the symbol. Keep the user-visible wording equivalent.

The help copy should continue steering users toward flat items:

```text
Flat items work best: foods, tools, ingots, gems, mob drops, plants, and
minerals usually make clearer puzzles than block icons.
```

Do not turn this into a marketing landing page. The tool itself is the first
screen.

The Generate action should not immediately download. It should prepare the PDF
and show the visualizer. Confirm download is the intentional download action.

The visualizer currently has four steps:

```text
Summary
Answer key
Coordinate coloring
Color by number
```

The summary step should include the Minecraft texture, a 16x16 color-map
preview, and a short list of produced deliverables. Keep the stepper compact and
work-focused.

## Visualizer Contract

Implementation file:

```text
app/PuzzleVisualizer.tsx
```

The visualizer is not a PDF renderer. It is a client-side preview of the same
source data used to render the PDF. It should help the facilitator understand
what will be downloaded before they commit to the file.

Current generated state shape:

```ts
GeneratedPuzzle {
  id: string
  url: string
  filename: string
  itemLabel: string
  sourceFilename: string
  colorCount: number
  opaqueCellCount: number
  textureUrl: string
  palette: PaletteEntry[]
  imageData: ImageData
}
```

Important details:

- `id` is used as a React key to reset the stepper when a new puzzle is
  generated.
- `url` is the PDF object URL used by Confirm download.
- `textureUrl` is the image object URL shown in the summary panel.
- `imageData` is currently retained for future visualizer work even though the
  present preview renders from the palette.
- The summary uses a plain `img` because the source is a browser object URL;
  Next Image is not appropriate for that local Blob.
- The preview grids render HTML/CSS approximations, not PDF pages. The PDF
  contract still lives in `lib/pdf/*`.

Stepper names and intent:

```text
Summary
  Texture, color-map preview, and produced deliverables.

Answer key
  Completed color grid plus coordinate legend.

Coordinate coloring
  Blank advanced grid plus coordinate legend.

Color by number
  Numbered student grid plus numeric color key.
```

Do not make Generate download. Do not hide Confirm below an ambiguous link.
Confirm is the deliberate point where the file leaves the browser.

## Friendly Error Policy

Do not show raw stack traces in the UI.

Use the buckets in `lib/errors.ts` and `friendlyError()` in `app/page.tsx`:

- Not found: spelling/item name guidance.
- Transparent: icon has no opaque pixels.
- Network: wiki unreachable, try again.
- Bad input: type an item name.
- Decode: texture decode failed.

For misspellings like `cookd salmon`, the page should show a friendly
"Couldn't find that item" message.

## Local Commands

Use `pnpm`.

```bash
pnpm install
pnpm lint
pnpm build
pnpm dev
```

If port 3000 is occupied, Next will choose another port. Use the printed local
URL for testing.

The app does not need `.env.local`. Vercel may create one during `vercel link`;
it is ignored and should not be committed.

## Local Proxy Smoke Checks

Set the origin to whatever `pnpm dev` printed:

```bash
WEB_ORIGIN=http://localhost:3000
```

Image proxy:

```bash
curl -fsS -D /tmp/wiki-image.headers -o /tmp/apple.png \
  "$WEB_ORIGIN/api/wiki?kind=image&path=Invicon_Apple.png"
grep -i '^content-type:.*image/png' /tmp/wiki-image.headers
test "$(wc -c </tmp/apple.png)" -gt 100
```

Article proxy:

```bash
curl -fsS -D /tmp/wiki-article.headers -o /tmp/cooked_salmon.html \
  "$WEB_ORIGIN/api/wiki?kind=article&path=Cooked_Salmon"
grep -i '^content-type:.*text/html' /tmp/wiki-article.headers
grep -q 'Invicon_Cooked_Salmon' /tmp/cooked_salmon.html
```

Bad path safety:

```bash
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  "$WEB_ORIGIN/api/wiki?kind=image&path=https://evil.example/x.png")" = 400
```

## Browser Smoke With Playwright CLI

The machine has `playwright-cli` available. Use session names so browser state
does not collide with other work.

Open the app:

```bash
playwright-cli -s=puzzle-local open "$WEB_ORIGIN"
```

Generate cooked salmon, confirm the preview appears without downloading, then
save the confirmed PDF:

```bash
playwright-cli -s=puzzle-local run-code "async page => {
  await page.goto(process.env.WEB_ORIGIN || 'http://localhost:3000');
  await page.getByLabel('Minecraft item').fill('cooked salmon');
  await page.getByLabel('Max colors').fill('8');
  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.getByRole('heading', { name: /Cooked Salmon worksheet set/ }).waitFor({
    timeout: 120000
  });
  if (downloaded) throw new Error('Generate downloaded before confirmation');
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.getByRole('button', { name: /Confirm download/ }).click();
  const download = await downloadPromise;
  await download.saveAs('/tmp/cooked_salmon_puzzle.pdf');
  return {
    filename: download.suggestedFilename(),
    status: await page.locator('[aria-live=polite]').innerText()
  };
}"
```

Close sessions when finished:

```bash
playwright-cli -s=puzzle-local close
```

## PDF Verification

`pdfinfo` is installed and is the fastest page/metadata check.

```bash
pdfinfo /tmp/cooked_salmon_puzzle.pdf | \
  awk -F': *' '/^(Title|Author|Subject|Pages|Page size):/{print}'
```

Expected for cooked salmon:

```text
Title: Cooked Salmon - Minecraft Pixel Art Puzzle
Subject: Source texture: Invicon_Cooked_Salmon.png
Author: Davis Puzzle Generator
Pages: 4
Page size: 612 x 792 pts (letter)
```

## Python Reference Spot-Check Values

Use the Python 3.12.4 interpreter on this machine if invoking the reference
script. The default `python3` may point at a broken pyenv shim.

```bash
PY=/Users/paulmikulskis/.pyenv/versions/3.12.4/bin/python3
REF=/Users/paulmikulskis/Development/Davis-Puzzle/minecraft-pixel-puzzle
```

Current Python reference values:

```text
item            max  palette  opaque  source
apple           4    4        114     Invicon_Apple.png
apple           8    8        114     Invicon_Apple.png
apple           12   10       114     Invicon_Apple.png
cooked salmon   4    4        90      Invicon_Cooked_Salmon.png
cooked salmon   8    8        90      Invicon_Cooked_Salmon.png
cooked salmon   12   12       90      Invicon_Cooked_Salmon.png
diamond         4    4        120     Invicon_Diamond.png
diamond         8    8        120     Invicon_Diamond.png
diamond         12   10       120     Invicon_Diamond.png
iron ingot      4    4        135     Invicon_Iron_Ingot.png
iron ingot      8    8        135     Invicon_Iron_Ingot.png
iron ingot      12   8        135     Invicon_Iron_Ingot.png
pufferfish      4    4        145     Invicon_Pufferfish.png
pufferfish      8    7        145     Invicon_Pufferfish.png
pufferfish      12   11       145     Invicon_Pufferfish.png
```

For acceptance-level browser checks, at minimum verify:

```text
apple, max 4 -> 114 cells, 4 colors
cooked salmon, max 8 -> 90 cells, 8 colors
diamond, max 8 -> 120 cells, 8 colors
iron ingot, max 8 -> 135 cells, 8 colors
pufferfish, max 8 -> 145 cells, 7 colors
```

## Production Verification

Production origin:

```bash
PROD=https://davis-puzzle-web.vercel.app
```

Proxy checks:

```bash
curl -fsS -D /tmp/puzzle-prod-apple.headers -o /tmp/puzzle-prod-apple.png \
  "$PROD/api/wiki?kind=image&path=Invicon_Apple.png"

curl -fsS -D /tmp/puzzle-prod-salmon.headers -o /tmp/puzzle-prod-salmon.html \
  "$PROD/api/wiki?kind=article&path=Cooked_Salmon"

test "$(curl -sS -o /dev/null -w '%{http_code}' \
  "$PROD/api/wiki?kind=image&path=https://evil.example/x.png")" = 400
```

Playwright production check should generate and save:

```text
/tmp/prod_cooked_salmon_puzzle.pdf
```

The production smoke should also verify that Generate does not download before
Confirm:

```text
Generate -> preview appears -> no download event
Next -> Answer key
Next -> Coordinate coloring
Next -> Color by number
Confirm download -> cooked_salmon_puzzle.pdf download event
```

Then run:

```bash
pdfinfo /tmp/prod_cooked_salmon_puzzle.pdf | \
  awk -F': *' '/^(Title|Author|Subject|Pages|Page size):/{print}'
```

## Deployment

The project is linked to Vercel under:

```text
scope: paulmikulskis-projects
project: davis-puzzle-web
```

Deploy production:

```bash
vercel --prod --yes --scope paulmikulskis-projects
```

Inspect production:

```bash
vercel inspect https://davis-puzzle-web.vercel.app --scope paulmikulskis-projects
```

The stable alias should remain:

```text
https://davis-puzzle-web.vercel.app
```

If Vercel scope behavior is ambiguous, explicitly pass:

```bash
--scope paulmikulskis-projects
```

Do not accidentally deploy this to the `Tools` scope unless Paul explicitly
asks for that.

## Git Hygiene

- Main branch is `main`.
- Remote is `origin`.
- Public GitHub repository is `paulmikulskis/davis-puzzle-web`.
- Keep `.env.local`, `.vercel`, `.next`, `node_modules`, and `.playwright-cli`
  out of commits.
- Commit source changes intentionally.
- Do not add generated PDFs to the repo.
- Do not add screenshots or binary artifacts unless explicitly requested.

Useful commands:

```bash
git status --short
git log --oneline --max-count=5 --decorate
git diff --check
```

## Things That Are Easy To Break

1. Page 2 title:
   The Python reference uses the hard/reference wording. Keep the current PDF
   title behavior aligned with `make_puzzle.py`.

2. PDF metadata:
   Andrew uses the Subject field to trace the source wiki texture. Always set
   the subject to `Source texture: <filename>`.

3. Pufferfish palette count:
   See the compatibility note above. This was verified after deployment.

4. Proxy allowlist parentheses:
   Parentheses are needed for filenames like `Invicon_Tropical_Fish_(Item).png`.

5. Blob URL lifecycle:
   Keep the generated PDF object URL and texture object URL alive while the
   preview is visible. Do not revoke the PDF object URL immediately after
   triggering Confirm; Safari can abort the download. Revoke URLs when a new
   puzzle replaces the current one or the component unmounts.

6. `pdf-lib` import:
   Keep it dynamically imported from the Generate path. Do not move it into the
   initial page bundle unless there is a measured reason.

7. Canvas-only image work:
   Do not add heavy image dependencies for a 256-pixel input.

8. Server statelessness:
   The server route should never generate, store, or cache PDFs.

## When Adding Features

Prefer small, boring changes that preserve the one-page utility shape.

Likely acceptable future changes:

- Query-string prefill for `?item=apple`.
- Slightly better item-name suggestions.
- More explicit classroom-friendly copy.
- A small "try these items" list.
- A local unit test for canonicalization or palette invariants.

Changes that need deliberate product discussion first:

- Custom images.
- Non-Minecraft sources.
- Different grid sizes.
- A4 paper.
- Multi-page layout variants.
- Server-side PDF rendering.
- Auth, accounts, analytics, or persistence.
- Palette editing/pinning.

## Final Pre-Handoff Checklist

Before saying a change is done:

1. `pnpm lint`
2. `pnpm build`
3. Local proxy smoke checks if API/fetch code changed.
4. Browser PDF generation if palette/PDF/UI flow changed.
5. `pdfinfo` page-count and metadata check if PDF code changed.
6. Spot-check item counts if palette/fetch code changed.
7. Production deploy and production smoke if deployment was requested.
8. `git status --short` is understood and clean unless intentionally left
   uncommitted.

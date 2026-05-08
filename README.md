# Minecraft Pixel Puzzle Web

Minecraft Pixel Puzzle Web is a tiny stateless Next.js utility for generating
Minecraft-themed occupational therapy worksheets. Andrew Davis designed the
original worksheet format so kids can practice hand-eye coordination,
visual-spatial reasoning, sustained focus, and fine motor control through a
playful 16x16 pixel-art activity. This web app ports the on-host Python
generator into a browser workflow that works from a classroom Chromebook.

Live app:

```text
https://davis-puzzle-web.vercel.app
```

GitHub repo:

```text
https://github.com/paulmikulskis/davis-puzzle-web
```

Canonical reference implementation:

```text
/Users/paulmikulskis/Development/Davis-Puzzle/minecraft-pixel-puzzle/make_puzzle.py
```

## North Star

The product should stay small, predictable, and classroom-ready:

- One page.
- One item-name input.
- One max-colors slider.
- One Generate action.
- One visual preview stepper.
- One Confirm download action.
- One wiki proxy route.
- No accounts, database, analytics, cache layer, env requirements, or server-side
  PDF generation.

The facilitator should be able to type a Minecraft item name, review what will
be produced, confirm the download, and leave with the same 4-page worksheet
format the Python tool creates.

## Current User Flow

1. Open the app.
2. Enter a Minecraft item name, for example `cooked salmon`.
3. Choose max colors from `4` to `12`, default `8`.
4. Click `Generate`.
5. The browser fetches the wiki texture through `/api/wiki`.
6. The browser decodes the icon into a 16x16 canvas and extracts the palette.
7. The browser dynamically imports `pdf-lib` and renders a 4-page PDF into a
   local object URL.
8. The app shows a preview stepper with:
   - Summary
   - Answer key
   - Coordinate coloring
   - Color by number
9. The user clicks `Confirm download`.
10. The browser downloads `<canonical_lowercase>_puzzle.pdf`.

`Generate` intentionally does not download. It prepares the PDF and previews the
deliverables. `Confirm download` is the only intentional download trigger.

## Produced PDF

Every generated PDF has exactly four Letter pages:

1. Cover sheet with the reflection prompts and workflow descriptions.
2. Facilitator reference / answer key.
3. Color-by-number worksheet.
4. Coordinate-coloring worksheet.

There is no fifth "Pasting by Number" page. The cover describes that workflow,
but the facilitator reuses the color-by-number sheet as the tile source.

PDF metadata is part of the product contract:

```text
Title: <Item Label> - Minecraft Pixel Art Puzzle
Author: Davis Puzzle Generator
Subject: Source texture: <wiki filename>
```

Andrew uses the Subject field to confirm which wiki texture produced a PDF.

## Inner Mechanics

The app is split across a small set of files:

```text
app/page.tsx
  Form state, generation orchestration, status/error messages, object URL
  lifecycle, and confirmed download trigger.

app/PuzzleVisualizer.tsx
  Preview stepper and visual deliverable summaries.

app/api/wiki/route.ts
  No-store minecraft.wiki proxy with a strict allowlist and polite User-Agent.

lib/fetchTexture.ts
  Direct filename attempts plus article scrape fallback.

lib/palette.ts
  Browser canvas decode, nearest-neighbor 16x16 resample, opaque-pixel scan,
  deterministic cell labeling, palette grouping, and pufferfish compatibility.

lib/pdf.ts and lib/pdf/*
  Browser-side PDF creation and ReportLab-equivalent page rendering.
```

The route handler only proxies wiki images and wiki articles. It never creates
or stores PDFs. The PDF is built entirely in the browser.

## Side Effects To Understand

- The wiki proxy makes upstream network requests to `minecraft.wiki`.
- The browser creates object URLs for the fetched texture and generated PDF.
- Object URLs must remain alive while the preview is visible.
- Object URLs are revoked when a new puzzle replaces the current one or the
  page/component unmounts.
- `pdf-lib` is loaded only after Generate, keeping initial page load smaller.
- The app may create local test PDFs in `/tmp` during smoke checks.
- Vercel may create `.env.local` during `vercel link`; it is ignored and not
  required by runtime code.

## Important Contracts

Texture lookup order:

```text
Invicon_<Canonical>.png
Invicon_Raw_<Canonical>.png
Invicon_Cooked_<Canonical>.png
article scrape fallback
```

Grid constants:

```text
GRID_N = 16
COLUMNS = ABCDEFGHIJKLMNOP
ROWS = abcdefghijklmnop
ALPHA_THRESHOLD = 32
```

Cell labels use uppercase column plus lowercase row:

```text
pixel (3, 10) -> Dk
```

Spot-check expectations:

```text
apple, max 4 -> 114 cells, 4 colors
cooked salmon, max 8 -> 90 cells, 8 colors
diamond, max 8 -> 120 cells, 8 colors
iron ingot, max 8 -> 135 cells, 8 colors
pufferfish, max 8 -> 145 cells, 7 colors
```

The pufferfish count is deliberate: Pillow leaves one max-8 palette slot unused,
and the web quantizer includes a compatibility fallback to match that behavior.

## Local Development

```bash
pnpm install
pnpm dev
```

If port 3000 is occupied, Next will print the available port it selected. Use
that printed URL for local smoke checks.

Quality checks:

```bash
pnpm lint
pnpm build
```

## Proxy Smoke Checks

Set `WEB_ORIGIN` to the local or production origin:

```bash
WEB_ORIGIN=http://localhost:3000
# or
WEB_ORIGIN=https://davis-puzzle-web.vercel.app
```

```bash
curl -fsS -D /tmp/wiki-image.headers -o /tmp/apple.png \
  "$WEB_ORIGIN/api/wiki?kind=image&path=Invicon_Apple.png"

curl -fsS -D /tmp/wiki-article.headers -o /tmp/cooked_salmon.html \
  "$WEB_ORIGIN/api/wiki?kind=article&path=Cooked_Salmon"

test "$(curl -sS -o /dev/null -w '%{http_code}' \
  "$WEB_ORIGIN/api/wiki?kind=image&path=https://evil.example/x.png")" = 400
```

## Browser Smoke Check

Use `playwright-cli` to verify the current preview-confirm behavior:

```bash
playwright-cli -s=puzzle-smoke open "$WEB_ORIGIN"
playwright-cli -s=puzzle-smoke run-code "async page => {
  await page.goto(process.env.WEB_ORIGIN || 'https://davis-puzzle-web.vercel.app');
  await page.getByLabel('Minecraft item').fill('cooked salmon');
  await page.getByLabel('Max colors').fill('8');
  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.getByRole('heading', { name: /Cooked Salmon worksheet set/ }).waitFor({
    timeout: 120000
  });
  if (downloaded) throw new Error('Generate downloaded before confirmation');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText(/Facilitator answer key/).waitFor();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText(/Advanced coordinate-coloring worksheet/).waitFor();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText(/Simplified color-by-number worksheet/).waitFor();
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.getByRole('button', { name: /Confirm download/ }).click();
  const download = await downloadPromise;
  await download.saveAs('/tmp/cooked_salmon_puzzle.pdf');
  return download.suggestedFilename();
}"
playwright-cli -s=puzzle-smoke close
```

Verify PDF metadata/page count:

```bash
pdfinfo /tmp/cooked_salmon_puzzle.pdf | \
  awk -F': *' '/^(Title|Author|Subject|Pages|Page size):/{print}'
```

Expected:

```text
Title: Cooked Salmon - Minecraft Pixel Art Puzzle
Subject: Source texture: Invicon_Cooked_Salmon.png
Author: Davis Puzzle Generator
Pages: 4
Page size: 612 x 792 pts (letter)
```

## Deployment

The Vercel project is linked under:

```text
scope: paulmikulskis-projects
project: davis-puzzle-web
```

Production deploy:

```bash
vercel --prod --yes --scope paulmikulskis-projects
```

Inspect production:

```bash
vercel inspect https://davis-puzzle-web.vercel.app --scope paulmikulskis-projects
```

## Credits

Andrew Davis designed the worksheet format. This is an unofficial fan-made tool.
Textures are Copyright Mojang and sourced from minecraft.wiki.

# Library Docs Design Reference

Style guide for HTML reference pages under `html-docs/`. Follow this when adding a new module doc to keep all pages visually consistent.

These pages document a **TypeScript library** (functions, parameters, return shapes, warnings, errors) — not HTTP endpoints. Pages use a **light theme** by default.

---

## File Structure

Each module gets its own subdirectory with a single `index.html`:

```
html-docs/
├── DESIGN.md                ← this file
├── index.html               ← landing page, links to every module
├── rc/
│   └── index.html
├── strengthening/
│   └── index.html
└── <module-name>/
    └── index.html
```

Module names match the package subpath exports (`rc`, `strengthening`, `core`, `utils`).

This directory is published verbatim to GitHub Pages by `.github/workflows/pages.yml` on
every push to `main` that touches it, so pages must work as plain static files — relative
links only, no build step. A new module page must also be added to the landing page's
module grid and Export Summary table in `html-docs/index.html`.

---

## Page Layout

```
┌──────────────┬────────────────────────────────────────┐
│   Sidebar    │              Main content               │
│   252 px     │         max-width 880 px                │
│   sticky     │         padding 40px 48px               │
└──────────────┴────────────────────────────────────────┘
```

- Sidebar: `position: sticky`, full viewport height, scrollable.
- Main: `flex: 1`, centred with `margin: 0 auto`, generous bottom padding for scroll comfort.
- The outer wrapper is `div.layout` with `display: flex`.

---

## Color Tokens

All colors are CSS custom properties on `:root`. **Never use raw hex values in component styles — always reference a token.** The palette is light-theme by default.

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#f6f7f9` | Page background |
| `--surface` | `#ffffff` | Card / sidebar background |
| `--surface-2` | `#f0f2f6` | Card header, table header background |
| `--border` | `#e2e5ec` | All borders and dividers |
| `--accent` | `#3b63d8` | Links, param names in tables, TYPE badge |
| `--accent-dim` | `rgba(59,99,216,0.08)` | Hover state on sidebar links, info alert bg |
| `--green` | `#1f9d63` | FN badge, "returns" states |
| `--green-dim` | `rgba(31,157,99,0.10)` | FN badge background |
| `--red` | `#d9463c` | ERROR badge, required param label, error alert |
| `--red-dim` | `rgba(217,70,60,0.08)` | ERROR badge background, error alert bg |
| `--yellow` | `#b97d0a` | CONST badge, number literals in code, warn alert |
| `--yellow-dim` | `rgba(230,160,30,0.12)` | CONST badge background, warn alert bg |
| `--purple` | `#8a4fd0` | Internal-helper badge, boolean/keyword color in code |
| `--purple-dim` | `rgba(138,79,208,0.10)` | Internal badge background |
| `--text` | `#1f2430` | Primary body text |
| `--text-muted` | `#5c6474` | Secondary text, descriptions |
| `--text-dim` | `#8a90a0` | Tertiary text, table headers, nav labels |
| `--code-bg` | `#f8f9fb` | Code block background |
| `--radius` | `8px` | Default border radius |
| `--radius-lg` | `12px` | Card border radius |
| `--mono` | `'JetBrains Mono', 'Fira Code', monospace` | All monospace elements |

Cards on the light surface need a subtle shadow instead of relying on background contrast:

```css
.card { box-shadow: 0 1px 3px rgba(20, 24, 40, 0.06); }
```

---

## Typography

Fonts are loaded from Google Fonts:

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
```

| Use | Font | Size | Weight |
|---|---|---|---|
| Body | Inter | 15px | 400 |
| Headings (page h1) | Inter | 26px | 700 |
| Section titles | Inter | 18px | 600 |
| Nav labels (uppercase) | Inter | 10px | 400 |
| Sidebar brand | Inter | 13.5px | 600 |
| Code / signatures | JetBrains Mono | varies | 400–700 |
| Param names in tables | JetBrains Mono | 12.5px | 400 |

---

## Components

### Sidebar

```html
<aside class="sidebar">
  <div class="sidebar__brand">
    <div class="brand-label">API Reference</div>
    <h2>Module Name</h2>
  </div>
  <nav>
    <div class="nav-section-label">Section</div>
    <a href="#anchor"><span class="mbadge m-fn">FN</span> functionName</a>
    <a href="#anchor"><span class="mbadge m-type">TYPE</span> TypeName</a>
    <a href="#anchor"><span style="font-size:14px">◈</span> Overview label</a>
  </nav>
</aside>
```

- Section groups are separated by `div.nav-section-label` with `margin-top: 8px` on subsequent groups.
- Icon-only nav items (non-export) use an inline `span` with a unicode symbol at `font-size:14px`.
- Active hover is handled by CSS only — no JavaScript needed.

### Kind Badges

Used inside sidebar nav links (`.mbadge`) and export card headers (`.kind`). They classify what an export is.

| Class | Color | Export kind |
|---|---|---|
| `.m-fn` | Green | Function |
| `.m-type` | Blue/Accent | Type / interface |
| `.m-const` | Yellow | Constant / constants object |
| `.m-error` | Red | Error class |

```html
<!-- In sidebar (smaller) -->
<span class="mbadge m-fn">FN</span>

<!-- In export card header (larger) -->
<span class="kind m-fn">FN</span>
```

### Scope Badges

Shown at the right of export card headers — where the export comes from and how it's meant to be used.

```html
<span class="scope-badge s-public">Public API</span>
<span class="scope-badge s-internal">Internal helper</span>
```

Public exports use the accent style; internal helpers (documented for contributors) use purple.

### Standard Badges

Shown after the scope badge in an export card header, naming the standard a calculation is based on.
Use it **only** where that standard is not ACI 318-19 — an export whose basis is the code needs no
badge, so the badge itself is the signal that the reader should check the basis before relying on
the result.

```html
<span class="std-badge" title="Basis: AISC 360 G2.1 — not ACI 318-19">AISC 360 G2.1</span>
```

- Yellow (`--yellow` on `--yellow-dim`), monospace, same pill shape as the scope badge.
- Place it **after** `.scope-badge`, which carries the `margin-left: auto` that pushes both right.
- Always pair it with a `title` attribute spelling out the basis and what it is *not*.
- Write the standard the way an engineer would cite it (`AISC 360 G2.1`, `ACI 440.2R-17 §11.4`), not
  in the compressed form used in runtime `reference` strings (`AISC360-22, G2.1`). Alert text keeps
  the compressed form so it matches the warnings the library actually returns.
- Any page carrying such a badge must also give the reader a **basis table** — quantity, basis,
  whether it is code or an adaptation — near the top of that section.

### Page Header

Always the first element inside `main.main`. Includes the import path tag, title, and description.

```html
<div class="page-header">
  <div class="import-tag">
    <span class="label">Import from</span>
    <code>@theerapat-s28/ts-structural-eng-tools/rc</code>
  </div>
  <h1>Module Name</h1>
  <p>One-sentence description of what the module calculates.</p>
</div>
```

### Sections

Each logical group (overview, a function family, reference tables) is a `div.section` with an anchor `id`.

```html
<div class="section" id="section-anchor">
  <div class="section__title">Section Title <code style="font-size:13px">rc-beam-design.ts</code></div>
  <!-- content -->
</div>
```

### Export Cards

One card per exported function / type / constant.

```html
<div class="export-card" id="export-anchor">
  <div class="export-card__header">
    <span class="kind m-fn">FN</span>
    <span class="ex-sig">rectBeamMomentCapacity(input)</span>
    <span class="scope-badge s-public">Public API</span>
  </div>
  <div class="export-card__body">
    <p class="ex-desc">Short description of what this function calculates.</p>

    <div class="sub-label">Parameters</div>
    <!-- param-table -->

    <div class="sub-label">Example</div>
    <!-- code-block: TypeScript call -->

    <div class="sub-label">Returns</div>
    <!-- code-block: result shape, then optional return-field table -->

    <!-- alerts: warnings, then errors -->
  </div>
</div>
```

`sub-label` order convention: **Parameters → param-table → Example → Returns → alerts**.

### Code Blocks

```html
<div class="code-block">
  <div class="code-block__label">TypeScript</div>
  <pre>
<span class="b">const</span> result = <span class="u">rectBeamMomentCapacity</span>({
  <span class="k">fc</span>: <span class="n">28</span>,          <span class="c">// MPa</span>
  <span class="k">unit</span>: <span class="s">'kN·m'</span>,
  <span class="k">isValid</span>: <span class="b">true</span>,
  <span class="k">warnings</span>: <span class="nl">null</span>
});
  </pre>
</div>
```

**Syntax highlight spans:**

| Class | Color | Use |
|---|---|---|
| `.k` | `#0e7490` (teal) | Object property names, parameter keys |
| `.s` | `#2f7d32` (green) | String values |
| `.n` | `--yellow` | Number values |
| `.b` | `--purple` | Keywords (`const`, `import`) and booleans |
| `.nl` | `--text-dim` | `null` / `undefined` values |
| `.c` | `--text-dim` italic | Inline comments (use these for units: `// MPa`, `// mm²`) |
| `.u` | `--accent` | Function names, import paths |

Common label values: `TypeScript`, `JSON`, `Result`.

Always annotate numeric inputs with their SI unit as a `.c` comment — units are implicit in this library, so the docs must make them visible.

### Parameter Tables

```html
<table class="param-table">
  <thead>
    <tr><th>Param</th><th>Type</th><th>Unit</th><th>Required?</th><th>Description</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>fc</td>
      <td>number</td>
      <td>MPa</td>
      <td><span class="req">Required</span></td>
      <td>Specified compressive strength of concrete</td>
    </tr>
    <tr>
      <td>compressionBars</td>
      <td>BarSpec[]</td>
      <td>—</td>
      <td><span class="opt">Optional</span></td>
      <td>Compression reinforcement layers, if any</td>
    </tr>
  </tbody>
</table>
```

- Use `.req` (red) for required params, `.opt` (dim) for optional.
- Column order: **Param → Type → Unit → Required? → Description**.
- Use `—` in the Unit column for dimensionless or non-numeric params.
- For return-field tables, omit the Required? column and use **Field → Type → Unit → Description**.

### Alerts

```html
<!-- Thrown error / assumption failure -->
<div class="alert alert--error">
  <span>⚠️</span>
  <span>Throws <strong>RCDesignError E102</strong> if the section is not tension controlled.</span>
</div>

<!-- Code-provision warning pushed to the warnings array -->
<div class="alert alert--warn">
  <span>⚠️</span>
  <span>Pushes a warning when ρ &lt; ρ<sub>min</sub> — <strong>ACI318-19, 9.6.1.2</strong>.</span>
</div>

<!-- Informational -->
<div class="alert alert--info">
  <span>ℹ️</span>
  <span>Background context or tip.</span>
</div>
```

Place alerts **after** the Returns block, warnings first, then errors. Multiple alerts are stacked vertically. Every warn alert must cite the exact code clause in `<strong>`; every error alert must name the error code.

### Inline Code

```html
<code>paramName</code>
```

Styled automatically: monospace, `--surface-2` background, `--accent` text. Use inside prose, table cells, and alert text. Do not use inside `pre` blocks.

### Export Summary Table

Always the **last section** on the page, with `id="summary"`.

```html
<div class="section" id="summary">
  <div class="section__title">Export Summary</div>
  <table class="summary-table">
    <thead>
      <tr><th>Kind</th><th>Export</th><th>Returns</th><th>Description</th></tr>
    </thead>
    <tbody>
      <tr>
        <td><span class="kind m-fn">FN</span></td>
        <td class="path-cell">rectBeamMomentCapacity</td>
        <td>{ phiMn, … }</td>
        <td>Short description</td>
      </tr>
    </tbody>
  </table>
</div>
```

List rows in the same top-to-bottom order as they appear in the sidebar.

### Flow Steps (optional)

Use for multi-step calculation procedures (e.g. the design workflow from section geometry to φMₙ).

```html
<div class="flow-steps">
  <div class="flow-step">
    <div class="step-num">1</div>
    <div class="step-body">
      <strong>Step title</strong><br/>
      Step description with <code>inline code</code> as needed.
    </div>
  </div>
  <!-- repeat for each step -->
</div>
```

### Model Grid (optional)

Use in the overview section to summarise the input/output types involved.

```html
<div class="model-grid">
  <div class="model-card">
    <div class="model-card__title">TypeName</div>
    <div class="model-card__desc">One-line description of this type's role.</div>
  </div>
</div>
```

---

## Anchor & ID Conventions

| Element | Pattern | Example |
|---|---|---|
| Section wrapper | `section-<topic>` | `section-capacity` |
| Export card | `<export-name>` (kebab-case) | `rect-beam-moment-capacity` |
| Overview | `overview` | `overview` |
| Summary | `summary` | `summary` |
| Special sections | descriptive kebab | `design-flow`, `units-reference` |

Sidebar `href` values must match the `id` of the target element exactly.

---

## Checklist for a New Doc Page

- [ ] Copy the full `<style>` block from an existing page — do not trim it
- [ ] Set `<title>` to `{Module} — API Reference`
- [ ] Sidebar brand `<h2>` matches the module name
- [ ] Page header has an `import-tag`, `<h1>`, and a one-sentence `<p>`
- [ ] Every export has its own `export-card` with a unique `id`
- [ ] Every sidebar link `href` matches a real element `id`
- [ ] Param tables use `.req` / `.opt` spans and a Unit column
- [ ] Code blocks use syntax-highlight spans (`.k`, `.s`, `.n`, `.b`, `.nl`, `.c`) and unit comments on numeric inputs
- [ ] Warnings documented in `.alert--warn` blocks citing the ACI clause
- [ ] Any calculation not based on ACI 318-19 carries a `.std-badge` and a basis table
- [ ] Thrown `RCDesignError`s documented in `.alert--error` blocks naming the error code
- [ ] Export Summary table is the last section
- [ ] Sidebar starts with the `← All modules` link back to `../`
- [ ] Module added to the grid and Export Summary table in `html-docs/index.html`
- [ ] Saved at `html-docs/<module-name>/index.html`

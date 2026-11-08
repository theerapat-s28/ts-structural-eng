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
├── about/
│   └── index.html           ← scope, responsibility, features, assumptions, limitations
├── rc/
│   ├── index.html           ← API reference
│   └── theory/              ← theory notes for the module
├── strengthening/
│   ├── index.html
│   └── theory/
└── <module-name>/
    ├── index.html
    └── theory/<topic>.html
```

Module names match the package subpath exports (`rc`, `strengthening`, `core`, `utils`).

Besides the API reference pages there are two other kinds of page:

- **About** (`about/index.html`): the project's introduction, the responsibility statement, the feature matrix, the assumptions and limitations, and the verification status. Keep it in step with the engine: when a feature lifts a limitation or adds one, update its row in the feature matrix and the limitations list (and the same sections of the README).
- **Theory notes** (`<module>/theory/<topic>.html`): the full formulation behind a group of exports. Set `<title>` to `{Topic} — Theory Notes` and the sidebar brand label to `Theory Notes`. Use the same sections in this order: Overview (with a **Basis** table: quantity, basis, code or adaptation), the derivation, **Verification** (each check, its reference and its test file), **Limitations**, **Points for review**, **References**, and **Summary** last. The theory pages share an extra style block for equations (`.eq`, `.mat`, `.frac`) and figures; copy it from an existing theory page. List every theory page on the landing page (`#theory-notes`) and on the about page (`#theory`).

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

- Sidebar: `position: sticky`, full viewport height, scrollable. On wide screens it can be folded away so the main content takes the full width; at 800 px and below it is a slide-in drawer. See [Foldable Panel](#foldable-panel).
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
<body>
<button class="nav-toggle" type="button" aria-controls="sidebar" aria-expanded="true" aria-label="Hide navigation" title="Hide navigation">«</button>
<div class="nav-backdrop" hidden></div>
<div class="layout">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar__brand">
      <div class="brand-label">API Reference</div>
      <h2>Module Name</h2>
    </div>
    <nav>
      <a href="../"><span style="font-size:14px">←</span> All modules</a>

      <details class="nav-group" open>
        <summary class="nav-section-label">Section</summary>
        <a href="#anchor"><span class="mbadge m-fn">FN</span> functionName</a>
        <a href="#anchor"><span class="mbadge m-type">TYPE</span> TypeName</a>
        <a href="#anchor"><span style="font-size:14px">◈</span> Overview label</a>
      </details>
    </nav>
  </aside>
  …
```

- Section groups are `details.nav-group` elements that fold one by one, and the whole panel folds away with `button.nav-toggle`. Both are specified in [Foldable Panel](#foldable-panel) below; every page must have them.
- Links outside any group (the `← All modules` link) stay directly in `nav`.
- Icon-only nav items (non-export) use an inline `span` with a unicode symbol at `font-size:14px`.
- Hover states are CSS only.

### Foldable Panel

The left panel folds in two ways, on every page:

1. **The whole panel**, with the toggle button at its top-right corner.
2. **Each group** in it ("Getting Started", "Members", …), by clicking its heading.

#### Behaviour

| Screen | Panel at load | Button | Click the button | Also closes the panel | Remembered |
|---|---|---|---|---|---|
| Wider than 800 px | Open, or folded if it was folded last time | `«` at the panel's top-right corner when open; `☰` at the page's top-left corner when folded | Folds the panel away, or brings it back (`html.nav-collapsed`) | — | Yes, across all pages (`docs-nav-collapsed`) |
| 800 px or less | Closed: the panel is a drawer off the left edge | `☰` at the top-left corner; `«` on the open drawer | Slides the drawer in over a dimmed backdrop (`html.nav-open`) | A link in the panel, the backdrop, or Esc (focus returns to the button) | No: the drawer always starts closed |

Groups start open. A folded group shows its chevron turned (▸ instead of ▾), and each page remembers its own folded groups (`docs-nav-folded:<path>`). Group folding is plain HTML (`<details>`), so it works even when JavaScript is off; only remembering it needs the script.

```
Wide screen, panel open        Wide screen, folded            Phone, drawer open
┌──────────┬────────────┐      ┌─────────────────────┐        ┌──────────┬──────────┐
│ Brand  « │            │      │☰                    │        │ Brand  « │░░░░░░░░░░│
│ ▾ Group  │   Main     │      │       Main          │        │ ▾ Group  │░ page  ░░│
│   link   │            │      │   (full width,      │        │   link   │░ behind░░│
│ ▸ Group  │            │      │    max 880 px)      │        │ ▸ Group  │░░░░░░░░░░│
└──────────┴────────────┘      └─────────────────────┘        └──────────┴──────────┘
```

#### Markup

The button and the backdrop come first in `<body>`; the panel needs `id="sidebar"` (the button's `aria-controls` and the script use it). See the [Sidebar](#sidebar) markup above for the full structure.

```html
<body>
<button class="nav-toggle" type="button" aria-controls="sidebar" aria-expanded="true" aria-label="Hide navigation" title="Hide navigation">«</button>
<div class="nav-backdrop" hidden></div>
<div class="layout">
  <aside class="sidebar" id="sidebar">
    …
    <details class="nav-group" open>
      <summary class="nav-section-label">Section</summary>
      <a href="#anchor">…</a>
    </details>
```

#### Styles

Part of the `<style>` block every page copies. The first block sits where the sidebar rules are, the second just before the page's `@media (max-width: 800px)` block, and the third is that media block itself (it replaces the old rule that hid the sidebar on phones).

```css
/* Foldable nav groups: <details class="nav-group" open><summary class="nav-section-label"> */
.nav-group + .nav-group,
nav > a + .nav-group { margin-top: 8px; }
summary.nav-section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  list-style: none;
  border-radius: 5px;
  user-select: none;
}
summary.nav-section-label::-webkit-details-marker { display: none; }
summary.nav-section-label::after {
  content: "▾";
  font-size: 11px;
  letter-spacing: 0;
  transition: transform 0.15s;
}
.nav-group:not([open]) > summary.nav-section-label::after { transform: rotate(-90deg); }
summary.nav-section-label:hover { color: var(--text-muted); }
summary.nav-section-label:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ── Collapsible sidebar: toggle button, folded state, phone drawer ── */
.sidebar__brand { padding-right: 40px; }
.nav-toggle {
  position: fixed;
  top: 14px;
  left: 208px;
  z-index: 50;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(20, 24, 40, 0.06);
}
.nav-toggle:hover { background: var(--accent-dim); color: var(--text); }
.nav-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.nav-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  background: rgba(20, 24, 40, 0.35);
}
.nav-backdrop[hidden] { display: none; }
@media (min-width: 801px) {
  html.nav-collapsed .sidebar { display: none; }
  html.nav-collapsed .nav-toggle { left: 12px; }
}
@media print {
  .nav-toggle, .nav-backdrop { display: none; }
}

@media (max-width: 800px) {
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 40;
    transform: translateX(-100%);
    visibility: hidden;
    transition: transform 0.2s ease, visibility 0.2s;
    box-shadow: 4px 0 16px rgba(20, 24, 40, 0.12);
  }
  html.nav-open .sidebar { transform: none; visibility: visible; }
  html:not(.nav-open) .nav-toggle { left: 12px; }
  .main { padding: 60px 20px 80px; }
}
```

#### Scripts

Two inline scripts, identical on every page; copy them unchanged.

At the end of `<head>`, so a folded panel does not flash open while the page loads:

```html
<script>
  // Restore the folded sidebar before the first paint, so the page does not flash open.
  try { if (localStorage.getItem("docs-nav-collapsed") === "1") document.documentElement.classList.add("nav-collapsed"); } catch (e) {}
</script>
```

Just before `</body>`:

```html
<script>
  // Sidebar: fold it away on wide screens (remembered), open it as a drawer on phones,
  // and remember which nav groups are folded on this page. Works without storage too.
  (function () {
    var root = document.documentElement;
    var button = document.querySelector(".nav-toggle");
    var sidebar = document.getElementById("sidebar");
    var backdrop = document.querySelector(".nav-backdrop");
    if (!button || !sidebar || !backdrop) return;
    var phone = window.matchMedia("(max-width: 800px)");
    var read = function (key) { try { return localStorage.getItem(key); } catch (e) { return null; } };
    var write = function (key, value) { try { localStorage.setItem(key, value); } catch (e) {} };

    var isOpen = function () {
      return phone.matches ? root.classList.contains("nav-open") : !root.classList.contains("nav-collapsed");
    };
    var sync = function () {
      var open = isOpen();
      var label = open ? "Hide navigation" : "Show navigation";
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", label);
      button.title = label;
      button.textContent = open ? "«" : "☰";
      backdrop.hidden = !(phone.matches && open);
    };
    var closeDrawer = function () { root.classList.remove("nav-open"); sync(); };

    button.addEventListener("click", function () {
      if (phone.matches) root.classList.toggle("nav-open");
      else write("docs-nav-collapsed", root.classList.toggle("nav-collapsed") ? "1" : "0");
      sync();
    });
    backdrop.addEventListener("click", closeDrawer);
    sidebar.addEventListener("click", function (event) {
      if (phone.matches && event.target.closest && event.target.closest("a")) closeDrawer();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && root.classList.contains("nav-open")) { closeDrawer(); button.focus(); }
    });
    if (phone.addEventListener) phone.addEventListener("change", closeDrawer);
    else if (phone.addListener) phone.addListener(closeDrawer);

    // Folded nav groups, per page, by their label.
    var key = "docs-nav-folded:" + location.pathname;
    var folded = [];
    try { folded = JSON.parse(read(key) || "[]"); } catch (e) { folded = []; }
    var groups = Array.prototype.slice.call(sidebar.querySelectorAll("details.nav-group"));
    var labelOf = function (group) { return group.querySelector("summary").textContent.trim(); };
    groups.forEach(function (group) {
      if (folded.indexOf(labelOf(group)) >= 0) group.open = false;
      group.addEventListener("toggle", function () {
        write(key, JSON.stringify(groups.filter(function (g) { return !g.open; }).map(labelOf)));
      });
    });

    sync();
  })();
</script>
```

#### Rules

- **Storage.** Only `localStorage`, only for these two conveniences, and every access inside `try`/`catch`: the page must work the same where storage is blocked (private windows, file previews). Keep the keys `docs-nav-collapsed` and `docs-nav-folded:<path>` unchanged, or readers lose their saved state.
- **Group labels are the saved keys.** A folded group is remembered by its heading text, so renaming a group simply opens it again; no migration is needed.
- **Accessibility.** The button keeps `aria-controls="sidebar"`, and the script updates `aria-expanded`, `aria-label` and `title` with the state. Headings and the button show a focus ring (`:focus-visible`), and the closed drawer is `visibility: hidden`, so its links are out of the tab order.
- **Breakpoint.** The 800 px in the CSS and in the script's `matchMedia("(max-width: 800px)")` must stay the same.
- **Print.** The button and the backdrop are hidden when printing.
- **No other scripts.** These two are the only JavaScript in the docs; pages must not need a build step or an external library.

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

### Notice Banner

Every page except the about page carries a short notice directly after the page header, linking to the about page's limitations. Copy its CSS (`.notice-banner`, in the `<style>` block of any page) together with the markup, and adjust the relative path to `about/`.

```html
<div class="notice-banner" role="note">
  <span>⚠️</span>
  <span><strong>A calculation aid, not a substitute for engineering judgement.</strong> Results must be checked and accepted by the qualified engineer responsible for the design. <a href="../about/#limitations">Scope, assumptions and limitations →</a></span>
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
- [ ] The notice banner follows the page header, linking to `about/#limitations`
- [ ] Every export has its own `export-card` with a unique `id`
- [ ] Every sidebar link `href` matches a real element `id`
- [ ] Param tables use `.req` / `.opt` spans and a Unit column
- [ ] Code blocks use syntax-highlight spans (`.k`, `.s`, `.n`, `.b`, `.nl`, `.c`) and unit comments on numeric inputs
- [ ] Warnings documented in `.alert--warn` blocks citing the ACI clause
- [ ] Any calculation not based on ACI 318-19 carries a `.std-badge` and a basis table
- [ ] Thrown `RCDesignError`s documented in `.alert--error` blocks naming the error code
- [ ] Export Summary table is the last section
- [ ] Sidebar starts with the `← All modules` link back to `../`
- [ ] Sidebar groups are `details.nav-group open`, the sidebar has `id="sidebar"`, and the page has the `.nav-toggle` button, the `.nav-backdrop`, the [Foldable Panel](#foldable-panel) styles and both of its scripts
- [ ] Module added to the grid and Export Summary table in `html-docs/index.html`
- [ ] Saved at `html-docs/<module-name>/index.html`

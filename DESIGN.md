---
version: mvp-screens
name: Gloaming
description: >-
  Calm Paper-First editorial UI for an English reading environment —
  warm peach surfaces (light) and warm paper-at-night surfaces (dark),
  single burnt-orange accent. Themes: light / dark / system.
  Token SSOT aligned with MVP Stitch screens (temp/gloaming) for light;
  dark palette designed for night reading, not inverted light.
colors:
  surface: '#fff8f5'
  surface-dim: '#e0d8d5'
  surface-bright: '#fff8f5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#faf2ee'
  surface-container: '#f4ece8'
  surface-container-high: '#eee7e3'
  surface-container-highest: '#e9e1dd'
  surface-variant: '#e9e1dd'
  on-surface: '#1e1b19'
  on-surface-variant: '#59413a'
  inverse-surface: '#33302d'
  inverse-on-surface: '#f7efeb'
  outline: '#8d7168'
  outline-variant: '#e1bfb5'
  surface-tint: '#ac3400'
  primary: '#9b2f00'
  on-primary: '#ffffff'
  primary-container: '#c2410c'
  on-primary-container: '#ffece7'
  inverse-primary: '#ffb59d'
  secondary: '#615e55'
  on-secondary: '#ffffff'
  secondary-container: '#e7e2d6'
  on-secondary-container: '#67645b'
  tertiary: '#545553'
  on-tertiary: '#ffffff'
  tertiary-container: '#6c6d6b'
  on-tertiary-container: '#f1f0ed'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbd0'
  primary-fixed-dim: '#ffb59d'
  on-primary-fixed: '#390c00'
  on-primary-fixed-variant: '#832600'
  secondary-fixed: '#e7e2d6'
  secondary-fixed-dim: '#cac6bb'
  on-secondary-fixed: '#1d1c15'
  on-secondary-fixed-variant: '#49473e'
  tertiary-fixed: '#e3e2e0'
  tertiary-fixed-dim: '#c7c6c4'
  on-tertiary-fixed: '#1a1c1a'
  on-tertiary-fixed-variant: '#464745'
  background: '#fff8f5'
  on-background: '#1e1b19'
  # App / shadcn semantic aliases (implemented in apps/web/app/globals.css)
  paper: '{colors.secondary-container}'
  brand: '{colors.primary-container}'
  brand-deep: '{colors.primary}'
  brand-soft: '{colors.primary-fixed}'
  canvas: '{colors.background}'
  ink: '{colors.on-surface}'
  muted-foreground: '{colors.on-surface-variant}'
  border: '{colors.outline-variant}'
  shadcn-primary: '{colors.primary-container}'
  shadcn-secondary: '{colors.secondary-container}'
  accent: '{colors.primary-fixed}'
  accent-foreground: '{colors.primary}'
  card: '{colors.surface-container-lowest}'
  destructive: '{colors.error}'
# Dark primitives — warm paper-at-night (not inverted light; not OLED black).
# Implement under html.dark in apps/web/app/globals.css. Same semantic alias names.
colorsDark:
  surface: '#1c1816'
  surface-dim: '#141210'
  surface-bright: '#241f1c'
  surface-container-lowest: '#2a2522'
  surface-container-low: '#231f1c'
  surface-container: '#2e2926'
  surface-container-high: '#38322e'
  surface-container-highest: '#423c37'
  surface-variant: '#423c37'
  on-surface: '#f0e8e3'
  on-surface-variant: '#c4b0a7'
  inverse-surface: '#f0e8e3'
  inverse-on-surface: '#2a2522'
  outline: '#9a8176'
  outline-variant: '#5c4a42'
  surface-tint: '#ff8a65'
  primary: '#9b2f00'
  on-primary: '#ffffff'
  primary-container: '#d4541c'
  on-primary-container: '#fff0eb'
  inverse-primary: '#ffb59d'
  secondary: '#cac6bb'
  on-secondary: '#1d1c15'
  secondary-container: '#2f2b26'
  on-secondary-container: '#c4b0a7'
  tertiary: '#c7c6c4'
  on-tertiary: '#1a1c1a'
  tertiary-container: '#3a3a38'
  on-tertiary-container: '#e3e2e0'
  error: '#ff8a80'
  on-error: '#1c1816'
  error-container: '#5c1818'
  on-error-container: '#ffdad6'
  primary-fixed: '#3d261c'
  primary-fixed-dim: '#5a3224'
  on-primary-fixed: '#ffdbd0'
  on-primary-fixed-variant: '#ffb59d'
  secondary-fixed: '#2f2b26'
  secondary-fixed-dim: '#3a3530'
  on-secondary-fixed: '#f0e8e3'
  on-secondary-fixed-variant: '#c4b0a7'
  tertiary-fixed: '#3a3a38'
  tertiary-fixed-dim: '#464745'
  on-tertiary-fixed: '#f0e8e3'
  on-tertiary-fixed-variant: '#c7c6c4'
  background: '#1c1816'
  on-background: '#f0e8e3'
  paper: '{colorsDark.secondary-container}'
  brand: '{colorsDark.primary-container}'
  brand-deep: '{colorsDark.primary}'
  brand-soft: '{colorsDark.primary-fixed}'
  canvas: '{colorsDark.background}'
  ink: '{colorsDark.on-surface}'
  muted-foreground: '{colorsDark.on-surface-variant}'
  border: '{colorsDark.outline-variant}'
  shadcn-primary: '{colorsDark.primary-container}'
  shadcn-secondary: '{colorsDark.secondary-container}'
  accent: '{colorsDark.primary-fixed}'
  # Chip / soft-accent label on dark wash — use light ember, not deep fill.
  accent-foreground: '{colorsDark.inverse-primary}'
  card: '{colorsDark.surface-container-lowest}'
  destructive: '{colorsDark.error}'
typography:
  display-editorial:
    fontFamily: Source Serif 4, Noto Serif SC, serif
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Source Serif 4, Noto Serif SC, serif
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Source Serif 4, Noto Serif SC, serif
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Source Serif 4, Noto Serif SC, serif
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-reading:
    fontFamily: Source Serif 4, Noto Serif SC, serif
    fontSize: 20px
    fontWeight: '400'
    lineHeight: 36px
    letterSpacing: 0.01em
  body-ui:
    fontFamily: Source Sans 3, Noto Sans SC, sans-serif
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-ui-sm:
    fontFamily: Source Sans 3, Noto Sans SC, sans-serif
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Source Sans 3, Noto Sans SC, sans-serif
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-ui:
    fontFamily: Source Sans 3, Noto Sans SC, sans-serif
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
  # App conventions
  control: 0.75rem
  panel: 1rem
  app-cta: 0.75rem
  auth-cta: 9999px
spacing:
  reading-column: 680px
  gutter: 2rem
  margin-mobile: 1.5rem
  stack-lg: 4rem
  stack-md: 2rem
  stack-sm: 1rem
  # Page chrome: Tailwind `container` (responsive; large-screen ceiling in globals.css).
  container-max: 1200px
theme:
  modes: [light, dark, system]
  default: system
  persistence: next-themes-localStorage
  runtime: html-class-dark
  selector: html.dark
---

# Gloaming Design System

Agent-facing visual identity. **Normative values live in the YAML front matter**; prose below explains character and usage. Implement in `apps/web` via CSS variables / shadcn semantic tokens in [`apps/web/app/globals.css`](apps/web/app/globals.css) — **do not hardcode hex in feature or component UI**.

**Status:** MVP foundations with **Light + Dark** token SSOT. Light aligns with Stitch MVP screens (`temp/`, local only). Dark is a designed **warm paper-at-night** palette for night reading — not an invert of Light, not OLED pure black.

**Related:** `docs/product/` (product philosophy + screen flows, not visual tokens) · interaction references: Apple Books, TextStack, Readest — [`docs/product/product-vision.md`](docs/product/product-vision.md) §8 (borrow patterns; `DESIGN.md` still wins on color, type, shape).

---

## Overview

Gloaming is a **Paper-First, Modern Editorial** reading environment. The UI should feel like a premium hardcover or literary journal: warm, quiet, and low-pressure — somewhere you come back to a book, not to a learning task.

**Character**

- Quietness: whitespace reduces cognitive load while reading authentic English
- Tactility: hierarchy from paper tone shifts, not heavy shadows
- Focus: chrome stays secondary to text until needed
- One burnt-orange ember accent — bookmark/firelight, never a dyed page
- Adult-to-adult tone; no shame, streak theater, or gamified noise

**User feeling to protect**

> “It’s quiet here. I can read a little. Help is there if I need it.”

---

## Theme system

### Modes

| Mode       | Behavior                                                           |
| ---------- | ------------------------------------------------------------------ |
| **Light**  | Warm peach paper surfaces (`colors` / `:root`)                     |
| **Dark**   | Warm paper-at-night surfaces (`colorsDark` / `html.dark`)          |
| **System** | Follow `prefers-color-scheme`; resolve to Light or Dark at runtime |

**Default:** `system`.

**Persistence:** `next-themes` with its default `localStorage` key. Do not invent a parallel theme store (no Zustand theme SoT).

**Runtime (locked):**

```text
html.dark  →  Dark CSS variables
(no .dark) →  Light CSS variables (:root)
```

- Tailwind / shadcn keep existing semantic names (`bg-background`, `text-muted-foreground`, …).
- Toggle class on `<html>` via `next-themes` (`attribute="class"`).
- Admin and Learner share the **same** Light / Dark tokens — never an Admin-only palette or component-level theme tree.
- Reader does **not** get a separate night theme system; global theme applies automatically.

### Theme switch entry (product chrome)

| Surface           | Entry                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| Desktop           | `SiteNav` icon button left of avatar (`ThemeModeNavButton`)                                      |
| Mobile (AppShell) | Same `SiteNav` icon button left of avatar (top chrome)                                           |
| Landing           | Same `SiteNav` control when signed in                                                            |
| Reader            | No dedicated theme control in Reader chrome — inherits global theme                              |
| Admin             | No Admin-specific theme control — inherits global theme                                          |
| Auth / guest      | No dedicated control required in MVP; System default applies until signed-in chrome is available |

Chinese labels for the control (system UI): e.g. 外观 / 主题，选项 **浅色** / **深色** / **跟随系统**.

### Theme design principles

1. **Semantic tokens first** — features and components use token classes / `var(--…)`, never theme-conditional hex.
2. **One Design System** — Dark is a second value set for the same token names, not a parallel component library.
3. **Warm dark, not cold dark** — brown-umber night desk + ember accent; avoid blue-gray cyberpunk and pure `#000` OLED black.
4. **Reader first** — long-form contrast and glare matter more than “maximum punch.” Prefer warm off-white ink on warm near-black paper over stark white-on-black.
5. **Do not invert Light** — do not map white→black / 100→900 mechanically; rebuild elevation for night (darker base, lighter elevated panels).
6. **Accent stays ember** — one burnt-orange family; in Dark, soft washes become **deep ember panels**, not pastel peach floods.
7. **No new token names** unless an existing semantic cannot express a Dark need. Prefer alias remapping under `.dark` (see accent-foreground below).

### Alias remapping (Dark only — no new public tokens)

Most aliases keep the same resolution as Light. One intentional Dark override:

| Alias                                                 | Light resolves to                  | Dark resolves to              | Why                                                                                                                                                                                           |
| ----------------------------------------------------- | ---------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--accent-foreground` / `--sidebar-accent-foreground` | `primary` / brand-deep (`#9b2f00`) | `inverse-primary` (`#ffb59d`) | Soft accent chips sit on deep ember wash (`primary-fixed`); chip **label** must be light ember for contrast. Button hover still uses `--brand-deep` → Dark `primary` `#9b2f00` (deepen fill). |

Shadows in Dark must **not** mix against light `on-surface` (that produces pale glows). Under `html.dark`, `--gloaming-shadow-*` mixes against **black** (or near-black), e.g. `color-mix(in oklab, black 45%, transparent)` — same token **names**, Dark-specific formulas.

`color-scheme: light` on `:root` and `color-scheme: dark` on `html.dark` so native controls / scrollbars match.

---

## Colors

### Light — warm peach paper

Warm peach neutrals plus a **single** burnt-orange accent family.

| Token                               | Hex                   | Role                                         |
| ----------------------------------- | --------------------- | -------------------------------------------- |
| Background / Surface                | `#fff8f5`             | App page wash (`background`, `surface`)      |
| Surface container low → high        | `#faf2ee` … `#eee7e3` | Tonal panels, chips, docks                   |
| Surface container lowest            | `#ffffff`             | Cards, popovers, overlays (`card`)           |
| Surface container highest / variant | `#e9e1dd`             | Stronger fills, progress tracks              |
| On-surface                          | `#1e1b19`             | Primary text (`foreground`)                  |
| On-surface-variant                  | `#59413a`             | Secondary copy (`muted-foreground`)          |
| Primary (deep)                      | `#9b2f00`             | Hover / deeper emphasis (`brand-deep`)       |
| Primary container                   | `#c2410c`             | Filled CTA / shadcn `primary`                |
| On-primary-container                | `#ffece7`             | Text on filled CTA when needed               |
| Primary fixed                       | `#ffdbd0`             | Small accent washes (`accent`, `brand-soft`) |
| Secondary container                 | `#e7e2d6`             | Warm paper panels (`secondary`, `paper`)     |
| Outline                             | `#8d7168`             | Stronger structural lines                    |
| Outline variant                     | `#e1bfb5`             | Default hairlines / inputs (`border`)        |
| Error                               | `#ba1a1a`             | Destructive (`destructive`)                  |

### Dark — warm paper-at-night

Night reading desk: umber base, warm elevated panels, ember accents. YAML SSOT: `colorsDark`.

| Token                               | Hex                   | Role                                                     |
| ----------------------------------- | --------------------- | -------------------------------------------------------- |
| Background / Surface                | `#1c1816`             | App / Reader page wash — warm near-black, **not** `#000` |
| Surface container low → high        | `#231f1c` … `#38322e` | Tonal panels, docks, TOC wash                            |
| Surface container lowest            | `#2a2522`             | Cards, popovers, AI panels (`card`)                      |
| Surface container highest / variant | `#423c37`             | Stronger fills, progress tracks                          |
| On-surface                          | `#f0e8e3`             | Primary text — warm off-white (reduce glare vs `#fff`)   |
| On-surface-variant                  | `#c4b0a7`             | Secondary copy (`muted-foreground`)                      |
| Primary (deep)                      | `#9b2f00`             | Button hover deepen (`brand-deep`)                       |
| Primary container                   | `#d4541c`             | Filled CTA — slightly brighter than Light for dark UI    |
| Inverse primary                     | `#ffb59d`             | Soft-accent **labels** / ember text on dark washes       |
| Primary fixed                       | `#3d261c`             | Small accent washes (`accent`, `brand-soft`)             |
| Secondary container                 | `#2f2b26`             | Warm night-paper panels (`secondary`, `paper`)           |
| Outline                             | `#9a8176`             | Stronger structural lines                                |
| Outline variant                     | `#5c4a42`             | Default hairlines / inputs (`border`)                    |
| Error                               | `#ff8a80`             | Destructive text/icons on dark surfaces                  |

**Usage rules (both themes)**

- **Primary container** = the one important action per region, current nav fills, progress fills — not every link or icon.
- **Primary fixed / brand-soft** = small areas only (selected nav chip, logo mark). Never large section fills. In Dark this is a **deep ember panel**, not a peach flood.
- **Large warm fields** = `secondary-container` / `paper` / `surface-container-*`, never primary-fixed.
- One accent hue only; no fourth competing warm gray invented ad hoc in feature CSS.
- Hex literals belong **only** in `DESIGN.md` YAML and theme primitive blocks in `globals.css` (`:root` and `html.dark`). Everywhere else: semantic Tailwind classes or `var(--…)`.

### State tokens

The product today exposes **destructive / error** only. There are **no** `success` / `warning` / `info` semantic CSS tokens in `globals.css`. Do not invent them for Dark Theme alone — add later only when product UI needs them in both themes.

| Token                       | Light     | Dark      | Notes                                               |
| --------------------------- | --------- | --------- | --------------------------------------------------- |
| `--destructive` / `--error` | `#ba1a1a` | `#ff8a80` | Dark uses lighter error for icon/text on dark fills |
| `--error-container`         | `#ffdad6` | `#5c1818` | Soft destructive wash                               |
| `--on-error-container`      | `#93000a` | `#ffdad6` | Text on error wash                                  |

### Light → Dark token mapping (implementation SSOT)

Implement Dark values under `html.dark` (or `.dark` on `html`) mirroring `:root` wiring. Semantic names unchanged.

| Token                                                | Light           | Dark                                     | Semantic meaning          | Reader impact                               |
| ---------------------------------------------------- | --------------- | ---------------------------------------- | ------------------------- | ------------------------------------------- |
| `--background` / `--md-background` / `--surface`     | `#fff8f5`       | `#1c1816`                                | App / page wash           | Reader canvas — primary night-reading field |
| `--foreground` / `--on-surface` / `--ink`            | `#1e1b19`       | `#f0e8e3`                                | Primary text              | Body + headings                             |
| `--card` / `--surface-container-lowest`              | `#ffffff`       | `#2a2522`                                | Elevated surface          | AI drawer, toolbars, popovers               |
| `--card-foreground` / `--popover-foreground`         | `#1e1b19`       | `#f0e8e3`                                | Text on elevated          | Drawer / menu copy                          |
| `--popover`                                          | `#ffffff`       | `#2a2522`                                | Floating surface          | Translation / account menus                 |
| `--paper` / `--secondary` / `--secondary-container`  | `#e7e2d6`       | `#2f2b26`                                | Warm paper panel          | Shelf cards, TOC active wash                |
| `--secondary-foreground`                             | `#1e1b19`       | `#f0e8e3`                                | Text on paper             | —                                           |
| `--muted` / `--surface-container`                    | `#f4ece8`       | `#2e2926`                                | Muted wash                | Skeletons, inset wells                      |
| `--muted-foreground` / `--on-surface-variant`        | `#59413a`       | `#c4b0a7`                                | Secondary text            | Meta, captions, idle nav                    |
| `--surface-container-low` / `--sidebar`              | `#faf2ee`       | `#231f1c`                                | Soft panel / sidebar      | TOC sidebar, Admin sidebar                  |
| `--surface-container-high`                           | `#eee7e3`       | `#38322e`                                | Stronger fill             | Hover wells                                 |
| `--surface-container-highest` / `--surface-variant`  | `#e9e1dd`       | `#423c37`                                | Strongest neutral fill    | Progress tracks                             |
| `--primary` / `--primary-container` / `--brand`      | `#c2410c`       | `#d4541c`                                | Brand action fill         | CTA, progress, active ember                 |
| `--primary-foreground` / `--on-primary`              | `#ffffff`       | `#ffffff`                                | Text on CTA               | Button labels                               |
| `--brand-deep` / `--md-primary`                      | `#9b2f00`       | `#9b2f00`                                | Deeper ember / hover fill | `hover:bg-brand-deep`                       |
| `--accent` / `--brand-soft` / `--primary-fixed`      | `#ffdbd0`       | `#3d261c`                                | Soft accent wash          | Chips, selected washes (small only)         |
| `--accent-foreground`                                | `#9b2f00`       | `#ffb59d`                                | Text on soft accent       | Chip labels (Dark remapped)                 |
| `--border` / `--input` / `--outline-variant`         | `#e1bfb5`       | `#5c4a42`                                | Hairline / field edge     | Inputs, separators                          |
| `--outline`                                          | `#8d7168`       | `#9a8176`                                | Stronger line             | Blockquotes, HR                             |
| `--ring` / `--sidebar-ring`                          | `#c2410c`       | `#d4541c`                                | Focus ring                | Keyboard focus                              |
| `--destructive`                                      | `#ba1a1a`       | `#ff8a80`                                | Danger                    | Destructive actions                         |
| `--selection`                                        | mix primary 22% | mix primary ~28%                         | Text selection wash       | Reader selection                            |
| `--selection-foreground`                             | `#1e1b19`       | `#f0e8e3`                                | Selected text             | —                                           |
| `--sidebar-accent`                                   | `#ffdbd0`       | `#3d261c`                                | Sidebar active wash       | Admin / TOC related                         |
| `--sidebar-accent-foreground`                        | `#9b2f00`       | `#ffb59d`                                | Sidebar active label      | Same remap as accent-foreground             |
| `--sidebar-border`                                   | `#e1bfb5`       | `#5c4a42`                                | Sidebar edge              | —                                           |
| `--sidebar-primary`                                  | `#c2410c`       | `#d4541c`                                | Sidebar primary fill      | —                                           |
| `--inverse-primary`                                  | `#ffb59d`       | `#ffb59d`                                | Light ember on dark       | Accent labels                               |
| `--inverse-surface`                                  | `#33302d`       | `#f0e8e3`                                | Inverted panel            | Rare inverse UI                             |
| `--canvas`                                           | → background    | → background                             | Compat alias              | —                                           |
| `--chart-1` … `--chart-5`                            | warm light set  | remap to Dark primary / secondary ladder | Charts                    | Heatmap-adjacent                            |
| `--gloaming-shadow-card` / `--gloaming-shadow-float` | mix on-surface  | mix **black**                            | Elevation                 | Cards / floats — Dark formula required      |

**No new tokens required** for Dark Theme. Existing names cover surfaces, text, brand, chrome, selection, sidebar, charts, and shadows.

### Token → shadcn / Tailwind map

| Design token                             | CSS / Tailwind                                            |
| ---------------------------------------- | --------------------------------------------------------- |
| `background`                             | `--background` / `bg-background`                          |
| `on-surface` / `on-background`           | `--foreground` / `text-foreground`                        |
| `primary-container`                      | `--primary` / `bg-primary` (button fill)                  |
| `primary`                                | `--brand-deep` / `text-brand-deep`, `hover:bg-brand-deep` |
| `primary-fixed`                          | `--accent` / `bg-accent`, `--brand-soft`                  |
| `on-primary`                             | `--primary-foreground`                                    |
| `secondary-container`                    | `--secondary` / `bg-secondary`, `--paper` / `bg-paper`    |
| `surface-container-lowest`               | `--card` / `bg-card`                                      |
| `surface-container` (+ low/high/highest) | `--surface-container*` / `bg-surface-container*`          |
| `on-surface-variant`                     | `--muted-foreground`                                      |
| `surface-container` (muted wash)         | `--muted` / `bg-muted`                                    |
| `outline-variant`                        | `--border` / `border-border`                              |
| `outline`                                | `--outline` / `border-outline` (stronger)                 |
| `error`                                  | `--destructive`                                           |
| `surface-tint`                           | hover deepen alternative (`--surface-tint`)               |

Compat aliases (`--canvas`, `--ink`, `--brand`, `--border-warm`, …) resolve to the tokens above so existing `bg-paper` / `text-brand-deep` classes keep working without hex.

---

## Night reading (Reader)

Reader is the **highest-priority** Dark surface. Global theme applies; do not fork a Reader-only palette.

| Concern                   | Token / rule                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Reading background        | `--background` (`#1c1816`) — full viewport wash                                                                    |
| Body text                 | `--foreground` (`#f0e8e3`) via `.reading-body` / `text-foreground`                                                 |
| Headings                  | `--foreground`; keep serif hierarchy — do not force primary/ember on every heading                                 |
| Secondary / captions      | `--muted-foreground`                                                                                               |
| Links in body             | `--primary` (`#d4541c`) — ember, not neon                                                                          |
| Selection                 | `--selection` soft ember wash; `--selection-foreground` warm ink                                                   |
| AI drawer / inline assist | `--card` panel, `--border`, quote in `--muted-foreground` / italic                                                 |
| Selection toolbar         | `--card` + hairline border + shadow-card (Dark shadow formula)                                                     |
| TOC sidebar               | `--surface-container-low`; active row `--secondary` / paper + `--primary` leading bar                              |
| Audio / chrome controls   | Ghost icon buttons: `--muted-foreground` idle → `--foreground` / `--primary` when active                           |
| Paper grain               | Same SVG grain asset; **lower opacity in Dark** (~1–1.5%, vs ~3% Light) — Dark-specific treatment, not a new asset |

**Night-reading don’ts**

- Don’t use pure `#000` backgrounds or pure `#fff` body text.
- Don’t flood the reading column with `--accent` / brand-soft.
- Don’t raise contrast with glow, neon outlines, or saturated orange page chrome.
- Don’t add a second “sepia / OLED / AMOLED” mode in MVP — Light / Dark / System only.

**Contrast targets (guidance)**

- Body text on background: aim **≥ 7:1** where practical (warm off-white on umber).
- Secondary text: aim **≥ 4.5:1** for essential meta; decorative idle chrome may sit near 3:1 if non-essential.
- Primary button (`#d4541c` + white label): verify ≥ 4.5:1.
- Focus ring: visible against both background and card.
- Placeholders / disabled: prefer opacity on muted tokens over inventing gray hex.

---

## Typography

Functional split between **Editorial Serif** and **Interface Sans** (never Inter / Roboto).

- **Serif (Source Serif 4 + Noto Serif SC):** display, headlines, book titles, long-form reading (`body-reading`).
- **Sans (Source Sans 3 + Noto Sans SC):** nav, settings, buttons, tooltips, dense UI (`body-ui`, `label-ui`, `label-caps`).
  - **Primary site-nav destinations** use **`body-ui` (16px)** — see Site nav contract.
  - **`label-ui` (14px)** is for denser / secondary chrome only (footer links, compact controls), not top-nav destinations.
- Use `label-caps` for meta like chapter or level labels.
- Load via `@fontsource-variable` in `apps/web` (`--font-ui`, `--font-display`, `--font-reading` in `globals.css`). Reader body uses `--font-reading` and does not inherit UI sans.
- Exact scales are frozen in the YAML front matter.
- Typography **scales and families do not change by theme** — only color tokens do.

---

## Layout & Spacing

Classical book rhythm: centered content, generous negative space.

- **Page chrome (`container`):** Use Tailwind’s `container` class for landing, app shell, and future marketing/product pages (centered + gutters in `apps/web/app/globals.css`). Do **not** hardcode a fixed shell width — use `max-width`. Stitch / temp prototypes use 1024 as an artboard, not a product lock. From `xl` up, content caps at **`1200px`** (`--container-max`) on large / 2K / 3K screens; sides keep paper margin. Long-form text still nests in the reading column.
- **Reading column:** Nest `max-w-reading-column` / `--reading-column` (~`680px`) inside `container` for long-form text (~50–75 characters). Grids and multi-column UI may use the full container width.
- **Full-bleed:** Backgrounds / hero photography span the viewport; inner content stays in `container`.
- **Rhythm:** 8px-based; prefer `stack-sm` / `stack-md` / `stack-lg` (1 / 2 / 4rem) over dense dashboard packing.
- **Gutters:** Mobile ≈ `1.5rem` (`margin-mobile`); `md+` ≈ `2rem` (`gutter`) — baked into `container`, avoid stacking extra `px-*` on the same node.
- Collapse multi-column layouts below ~768px.
- Layout metrics are **theme-independent**.

---

## Elevation & Depth

Depth from **tonal layering** and hairline outlines — not heavy drop shadows.

**Light**

- **Level 0:** `background` `#fff8f5`
- **Level 1:** warm paper (`secondary-container` / surface-container ladder)
- **Level 2:** white overlays (`surface-container-lowest`) with soft diffused shadow ≈ `0 4px 20px` at ~5–10% `on-surface`, plus subtle border

**Dark**

- **Level 0:** `background` `#1c1816`
- **Level 1:** night paper (`secondary-container` / surface-container ladder — lighter than base)
- **Level 2:** elevated panels (`surface-container-lowest` `#2a2522`) with soft shadow mixed from **black**, plus subtle `--border`

- Hover: shift tonal step / border — do not escalate to Tailwind `shadow-md` / `lg` / `xl`
- Optional global paper grain: fixed, non-interactive; ~3% opacity in Light; **~1–1.5% in Dark**; do not animate

---

## Shapes

- **Controls / in-app CTA:** `rounded-xl` ≈ `0.75rem` (`md` / `control` / `app-cta`)
- **Cards / main blocks:** `rounded-2xl` ≈ `1rem` (`lg` / `panel`)
- **Selection / compact:** `0.5rem` (`DEFAULT`)
- **Auth primary CTA:** `rounded-full` (pill) — intentional entry ritual
- Soft organic corners; no agency “double-bezel” nested card shells as default
- Radii are **theme-independent**.

---

## Components (visual contracts)

- **Primary button:** `bg-primary` (`primary-container`), white label; hover → `brand-deep` / `primary`. No gradients.
- **Secondary / ghost:** transparent + `border-border` (outline-variant); neutral text.
- **Reading / shelf cards:** warm `bg-paper` or `bg-surface-container-*`, `rounded-2xl`, prefer tonal edge over heavy border.
- **Translation / help popovers:** `bg-card`, `rounded-xl`, hairline border; serif for lemma, sans for notes.
- **Chips:** `rounded-full`, `bg-brand-soft` / `bg-accent`, accent-foreground text — small only.
- **Sidebar active:** soft accent wash + thin primary bar on the leading edge. (Legacy; learner chrome uses **Site nav** below.)
- **Site nav (top chrome) — locked:** Shared header for landing + learner pages. Implement via `components/navigation/*` (`SiteNav`, `DesktopNav`, shared `nav-config`) + `@utility site-nav-link` in `globals.css`; do not restyle ad hoc per page.
  - **Brand lockup:** mark + serif wordmark `Gloaming` (`BrandMark` `appearance="editorial"`).
  - **Primary links (desktop `md+`):** `body-ui` scale — **16px / 24 line-height**, weight **500** idle → **700** active. Not `label-ui` (14px); that token is for denser chrome (footer, meta, compact controls).
  - **Idle color:** `muted-foreground` / on-surface-variant; **hover / active:** `primary` (ember).
  - **Active indicator:** **2px** bottom underline in `primary`, with **4px** gap under the glyphs (`padding-bottom: 0.25rem`). Every link keeps a transparent 2px underline slot so the row does not jump. Do not use 1px hairlines for nav active — too weak on 2K/3K next to the 36px avatar.
  - **Row:** desktop height **64–80px**; link cluster `gap-8`; trailing **theme icon** (36px hit target) + **36px** avatar when signed in, or Sign In text when guest. **No** search field/icon in learner SiteNav until product search ships.
  - **Account:** Account menu holds account actions only (admin entry when applicable, sign out). **Theme mode** lives in the dedicated `ThemeModeNavButton` left of the avatar — not inside the account menu. No separate Settings product page required in MVP 1 for theme alone.
  - **Mobile (`< md`) top chrome:** Brand + theme icon + Avatar (or Sign In) — **no** hamburger / Sheet for primary destinations.
  - Temp Stitch HTML may disagree (14px / 1px underline on some screens) — **this contract wins**.
- **App bottom nav (mobile learner shell) — locked:** Only inside `AppShell` (`MobileBottomNav`). Not on Landing, Auth, Reader, or Admin.
  - **Tabs:** 书架 → 发现 → 历史 → 更多 (labels from `nav-config`; hrefs shared with desktop primary links).
  - **更多:** opens a bottom Sheet for extensions — **no** `/more` route. Future account/settings rows. Theme mode is **not** hosted here (top `SiteNav` icon). Placeholder-only rows may remain for not-yet-shipped items.
  - **Height:** **56px** tab row + `env(safe-area-inset-bottom)`.
  - **AppShell** exposes `--app-shell-bottom` so page sticky CTAs (e.g. book detail) sit above the tab bar; `md+` sets it to `0`.
  - **Active:** `primary` icon + label; idle `muted-foreground`. Quiet — no floating island / glow.

---

## Special visual elements (theme behavior)

| Element                            | Behavior                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Brand Mark / wordmark              | Wordmark uses `text-primary` / tokens → **auto follows**. Raster mark `/gloaming-mark.png` — **evaluate in Dark**; if contrast fails, request a Dark-optimized asset (do not invent ad hoc CSS filters as the long-term SSOT). |
| Landing Hero / atmosphere blurs    | Token-based (`bg-primary/…`, `bg-brand-soft/…`) → **auto follows**; verify soft accent washes don’t glow too hard in Dark.                                                                                                     |
| Cover / book thumbnail tints       | `bg-paper` / `bg-muted` / `bg-secondary` / `bg-accent/50` → **auto follows**.                                                                                                                                                  |
| History heatmap                    | **Dark-specific treatment** — supply `react-activity-calendar` `theme.dark` ramp; stop mixing against literal `white` (use background / surface mixes).                                                                        |
| Overlay / backdrop (`bg-black/10`) | Acceptable scrim; optional Dark bump to `bg-black/40` if sheets feel under-separated — prefer one shared tokenized opacity if changed.                                                                                         |
| Selection                          | Token `--selection*` → **auto follows** (Dark mix strength may be slightly higher).                                                                                                                                            |
| Shadows                            | **Dark-specific formula** on same `--gloaming-shadow-*` names (black mix).                                                                                                                                                     |
| Paper texture                      | Same asset; **Dark opacity reduction**.                                                                                                                                                                                        |
| Reading typography                 | Families/sizes unchanged; colors via tokens → **auto follows**.                                                                                                                                                                |

---

## Third-party theme strategy

| Library                     | Theme-sensitive? | Strategy                                                                                                                                                                                                                                                                                |
| --------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sonner** (`Toaster`)      | Yes              | Bind `theme` to `next-themes` resolved theme (`light` \| `dark`). With `defaultTheme="system"`, pass the **resolved** value (not the string `"system"`) so toasts match the painted UI. Prefer semantic styling; avoid relying on `richColors` alone for brand fit — verify both modes. |
| **react-activity-calendar** | Yes              | Provide both `light` and `dark` ramps in `ThemeInput`. Dark ramp: empty → low surface mix → ember steps → `--primary`. Do not hardcode `white` as mix target.                                                                                                                           |
| **Base UI / shadcn atoms**  | Partially        | Many atoms already ship `dark:` utility tweaks. They activate once `html.dark` + Dark CSS variables exist. Validate; do not fork a second component theme.                                                                                                                              |
| **Google brand SVG colors** | Brand-fixed      | Keep official Google colors; not theme tokens.                                                                                                                                                                                                                                          |

---

## Interaction philosophy

**Scope:** Product and interaction judgment for all Gloaming UI — what to show, what to merge, what to delete. **Visual polish** (typography, color, spacing, composition, anti-slop) stays in the sections above. **Frontend engineering boundaries** live in [`rules/frontend.md`](rules/frontend.md).

**Priority ladder (default):**

```text
Remove → Simplify → Combine → Clarify → Polish
```

Do not invert this by scaffolding a form shell first and decorating it afterward.

### Information economy

Every visible element must earn its place — label, description, helper text, badge, status line, heading, divider, card, button, icon button, or secondary action.

> If removing an element would not clearly hurt comprehension, discoverability, or function, prefer removing it.

Simplicity means reducing the effort needed to understand and act, not minimizing text, controls, or features. Keep text that names an action, communicates a meaningful state, describes useful content, explains an error or recovery, or states a necessary condition. Remove duplicate titles, explanations, and decorative copy. Ask what the page title, section, field, grouping, and control state already tell the user before adding another explanation.

### Self-explanatory hierarchy

Use familiar naming, placement, grouping, spacing, scale, contrast, and interaction states to make the page understandable at a glance. Prefer whitespace and clear hierarchy; add a border, background, or container only when it clarifies a relationship that spacing alone cannot. Use existing Paper-First semantic tokens and surface hierarchy. Avoid nested cards, decorative statistics, and repeated headings; follow the existing one-important-action-per-region rule.

When a control or section is hard to understand, first improve its structure, label, or behavior. Keep explanatory copy when it helps with unfamiliar tasks, reading context, accessibility, or discoverability.

### Action discovery and disclosure

For learner-facing surfaces, use concepts and names users recognize instead of internal domain terms. Admin surfaces may retain established operator vocabulary as described under **Admin workbench density**.

- Keep frequent and essential actions visible in the context where users need them.
- Put infrequent or advanced actions in a nearby menu, popover, or settings surface; do not bury a common task behind multiple layers.
- Before activation, make the action's outcome reasonably predictable through its visible name, placement, and current state. Use the feedback specified for that action; do not infer new persistence, confirmation, or side effects for visual simplicity.
- Reuse the same user-facing names and state meanings across learner surfaces.

### Icons, labels, and access

Use an icon alone only for a widely recognized action whose meaning remains clear in context. Give every icon-only control an accessible name. Use a visible concise label for ambiguous, domain-specific, or consequential actions; do not rely on a tooltip or hover to explain a core action. Tooltips may add context, but keyboard and mobile users must be able to discover and use the same core functions.

### Design review checks

For learner-facing surfaces, review from a first-time user's perspective. Apply **Admin workbench density** to operator surfaces.

1. Can they find the primary task and understand the current state from the page structure, labels, and visible state?
2. Can they predict the result of each prominent action before activating it?
3. Does every text element add distinct value, and does every container clarify a real relationship?
4. Are essential and frequent actions visible without depending on a tooltip, hover, or deep menu?
5. Can keyboard and mobile users discover and complete the same core tasks?

Use **Information economy** when deciding whether explanatory copy adds distinct value.

### Interaction compression

Before adding a control, ask which **object** and **user task** it belongs to. Operations that serve the same task on the same object should share one interaction context when possible.

| Prefer                                                                           | Over                                                             |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Refresh as a contextual action on a Select / Combobox                            | A standalone “fetch list” button above the Select                |
| Inline or icon action on the row it affects                                      | A separate toolbar button for the same row                       |
| One save surface per editing context (when product already uses form-level save) | Removing Save or switching to auto-save without product decision |

This is not “everything becomes an icon.” It is **task ownership first**, control shape second.

**UI vs product behavior:** Compression and delete-first optimize **layout and control grouping** only. They must **not** change when or how data loads, persists, confirms, or side-effects. If merging controls would require auto-save, blur-save, optimistic persistence, automatic fetch/refresh/submit/delete, or dropping confirmation → that is **PRODUCT / BEHAVIOR**, not UI simplification. Preserve shipped or specified behavior; flag and stop — do not infer.

### Contextual actions

Place actions on the object they affect — end of a field row, inside a Select trigger group, on the list row — instead of inventing a new standalone button because the capability exists.

Standalone buttons remain valid when the action is truly independent, destructive, or needs emphasis (primary submit, delete confirm, page-level create).

### State representation

Do not restate what the control already communicates.

- **Switch / Toggle:** the control is the state. Do not add a parallel “Enabled / 启用” label unless the switch label names something _other than_ on/off (e.g. “AI 模型” with the switch as the value).
- **Select / Combobox:** the selected value is the state. Do not add a redundant status badge for “已选择”.
- **Badge / status text:** use only when it adds information the control cannot show (health, error, drift from saved value).
- **Form vs collection:** in a **form**, do not restate control state in prose or badges; in a **list/table**, a status column for scanning many rows is valid — not the same as duplicating a Switch label.

Accessibility: use `aria-label` / visually hidden text when a control lacks a visible name — not a duplicate visible status word.

### Admin workbench density

Admin (`/admin/**`) serves operators who already understand Provider, Model, API Key, Enable/Disable, Refresh, Configuration.

- Context and field order carry meaning — not long descriptions on every field.
- Prefer compact rows, inline actions, and one section per task over nested cards, duplicate headings, and consumer-style helper stacks.
- Page-level intro copy: one line when the task is non-obvious; skip when the nav label + layout already state the job.
- **Same Light / Dark tokens and visual language as learner UI**; denser layout is OK — **not a second theme or Admin Dark palette**.

**Scope:** stricter economy applies to **admin / configuration** surfaces only. Reader, shelf, discover, auth, and onboarding may keep labels, descriptions, and text actions when unfamiliarity, reading context, accessibility, or discoverability need them. **Reduce cognitive load for the task and audience** — not merely element count globally.

### Decision order (before drawing UI)

```text
1. Product task — what must the user accomplish?
2. Minimum information — what cannot be inferred?
3. Minimum interactions — fewest controls that complete the task
4. Context inference — what do title / tab / grouping already tell them?
5. Merge related actions into shared control contexts
6. Delete redundant elements (review checks above)
7. Visual polish — tokens and visual contracts above for hierarchy and composition
```

The visual contracts above own **visual quality**; this section owns **product / interaction quality**. They complement each other.

---

## Do's and Don'ts

**Do**

- Read this file before generating or restyling UI — including **Theme system** and **Interaction philosophy**, not only color and type.
- Express color only through semantic tokens / CSS variables (`bg-primary`, `text-muted-foreground`, `var(--surface-container)`, …).
- Implement Dark exclusively as `html.dark { … }` variable overrides (+ documented alias remaps / shadow formulas).
- Keep one accent; motion nearly invisible (short color transitions; optional light `active:scale` on primary CTA).
- Keep **system UI language Chinese** (labels, nav, empty states, toasts, placeholders, theme control) until product i18n is explicit; learning content may be EN/ZH.
- For reader chrome, shelf, and discover flows, borrow interaction from Apple Books / TextStack / Readest — not their visuals or study features (e.g. SRS).
- Prefer `next-themes` for mode persistence and FOUC-safe class application.

**Don't**

- Don’t hardcode hex (or one-off `rgb()`/`oklch()` palettes) in `features/**` or `components/**` except via theme variables.
- Don’t ship Inter, Roboto, or generic “AI purple / neon glass” looks.
- Don’t use primary/brand as the default color for all interactive text.
- Don’t fill large regions with brand-soft / primary-fixed or saturated orange (in Dark: don’t flood with deep ember either).
- Don’t add heavy shadows, glow, mesh gradients, floating island nav, or cinematic scroll theater.
- Don’t invert Light hex values mechanically or ship OLED `#000` / harsh `#fff` reading surfaces.
- Don’t invent a parallel token set or component theme tree for Dark — extend this file / `globals.css` first.
- Don’t invent a second Admin color theme — same tokens; denser workbench layout is OK.
- Don’t add Reader-only or Admin-only theme runtimes.
- Don’t add labels, descriptions, badges, cards, or buttons “to be complete” when context or the control already carries the meaning — see **Interaction philosophy**.
- Don’t let UI simplification infer product behavior (auto-save, automatic fetch, implicit confirm, etc.) — see **UI vs product behavior** under Interaction compression.

**UI composition:** Prefer shadcn atoms, then Tailwind polish, then limited native markup. Apply **Remove → Simplify → Combine → Clarify → Polish** before visual polish. Engineering boundaries: [`rules/frontend.md`](rules/frontend.md); component operating guidance belongs to the applicable Skill and current configuration.

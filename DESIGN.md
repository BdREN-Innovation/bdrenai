---
name: BdREN AI
description: Four AI tools for Bangladesh's universities and offices, presented as a four-track record sleeve.
colors:
  night: "#1846C9"
  night-deep: "#10319A"
  night-raised: "#2152D3"
  night-card: "#2B5BDB"
  night-line: "#4A72E0"
  night-stroke: "#8AA5EE"
  track-synapse: "#1846C9"
  track-mindspear: "#0B7F80"
  track-mail: "#C92A5C"
  track-quigen: "#7B3FC4"
  ink: "#14131C"
  white: "#FFFFFF"
  ground: "#F5F6FB"
  line: "#DDE1EE"
  field: "#B5BCD3"
  muted: "#4A4E63"
  haze: "#DCE5FF"
  fog: "#EEF2FF"
  brand-tint: "#E8EEFF"
typography:
  display:
    fontFamily: "Fredoka, Nunito, sans-serif"
    fontSize: "clamp(104px, 10.5vw, 160px)"
    fontWeight: 700
    lineHeight: 0.86
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Fredoka, Nunito, sans-serif"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Fredoka, Nunito, sans-serif"
    fontSize: "44px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.025em"
  track:
    fontFamily: "Fredoka, Nunito, sans-serif"
    fontSize: "27px"
    fontWeight: 500
    lineHeight: 1.2
  body:
    fontFamily: "Nunito, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Fredoka, Nunito, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  bangla:
    fontFamily: "Baloo Da 2, sans-serif"
    fontWeight: 500
rounded:
  input: "12px"
  tile: "14px"
  card: "24px"
  sleeve: "28px"
  pill: "9999px"
spacing:
  gutter: "24px"
  card-pad: "28px"
  section-y: "96px"
  section-y-lg: "112px"
  container: "1240px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.night-deep}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "48px"
  button-outline-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
  button-outline-dark:
    backgroundColor: "transparent"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "48px"
  button-outline-dark-hover:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
  button-white:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "46px"
  button-white-hover:
    backgroundColor: "{colors.fog}"
  card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-pad}"
  sleeve-card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sleeve}"
    padding: "{spacing.card-pad}"
    width: "400px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "0 16px"
    height: "52px"
  track-row:
    textColor: "{colors.white}"
    typography: "{typography.track}"
    height: "52px"
---

# Design System: BdREN AI

## Overview

**Creative North Star: "The Four-Track Sleeve"**

BdREN AI is pressed like a record sleeve: four products, four tracks, each with its own flat, saturated ground. The first screen fills completely with the chosen product's colour, a huge rounded wordmark sits on it, and the products line up as a short ruled track list. Choosing a track floods the whole ground with that product's colour. Below the sleeve the pages return to white and a cool pale ground, and the four colours shrink to markers: numbered discs, bullet dots, category names.

The world is friendly and plain-spoken, not corporate. Fredoka's rounded letterforms carry display and controls, Nunito carries reading, and Baloo Da 2 carries Bangla at equal standing. Shapes are soft (pill controls, 24 to 28px card corners) and colour is flat: no gradients between hues, no textures, no glows. Depth comes from coloured fields meeting white, not from shadows. Ink (#14131C) anchors the system: primary pills, the footer, the focus ring and text selection.

Imagery is a product clip printed into the ground like a duotone (grayscale, multiplied by the ground colour, faded behind the wordmark). The current clips are labelled placeholders, captioned "Sample clip, not product footage" on the page, until real screen recordings replace them.

**Key Characteristics:**
- One flat saturated ground per product; white is the relief colour on it.
- Ink for primary actions and the footer; deep blue (night) for site chrome and the Suite band.
- Fredoka display and controls, Nunito reading, Baloo Da 2 Bangla.
- Pill buttons, soft 24 to 28px containers, 2px ruled rows.
- Flat by default; one soft lift only where a white card sits on a coloured ground.
- Motion is a colour cross-fade and a small lift-in; all of it stops under reduced motion.

## Colors

A four-colour product set on flat grounds, held together by one near-black ink and a family of cool blue-white tints.

### Primary
- **Synapse Deep Blue** (night / track-synapse): The house ground. The non-overlay header, the Suite band, the sleeve's default ground and Synapse's own ground. Also the in-text accent on white (Tailwind alias `brand-text`): link hover, the large step numerals, arrow marks.
- **Midnight Blue** (night-deep): Primary-button hover and the strong accent on pale tints (alias `brand-strong`), e.g. "Compare with the Suite" on brand-tint.
- **Raised / Card / Line / Stroke Blues** (night-raised, night-card, night-line, night-stroke): Tonal steps on a night or ink field: raised panels, the admin-feature tiles on ink, the header's bottom rule, the profile pill's outline. `night-edge` is an alias of night-line.

### Secondary (the product tracks)
- **Mindspear Teal** (track-mindspear): Mindspear's ground and markers.
- **Mail Wizard Raspberry** (track-mail): AI Mail Wizard's ground and markers.
- **QuiGen Violet** (track-quigen): QuiGen's ground and markers.

Each product's colour lives in `content/products.ts` as `color` and is applied inline as the sleeve's `--ground`, the product page's hero ground, the numbered track disc, the bullet dots and the category label. All four carry white text at AA (lowest: Mindspear teal, 4.8:1).

### Neutral
- **Ink** (ink, alias `brand`): Primary pills, the footer field, the 2px rules of the products list, body text, the focus ring, the selection highlight, the logo tile.
- **White** (white): Reading surfaces, cards, the overview card, the sign-in pill, and the only relief colour on a product ground.
- **Cool Ground** (ground): The page background below the sleeve; menu-row hover.
- **Hairline** (line): 1px dividers, card borders, the fact-strip rules.
- **Field Stroke** (field): Input borders.
- **Slate** (muted): Secondary text on white and ground (8.5:1 on white).
- **Haze** (haze, alias `mist`): Secondary text on night and ink: Suite band copy, footer links, admin-section intros.
- **Fog** (fog): Inactive header links, hover fill for white pills.
- **Pale Blue Tint** (brand-tint): The Suite reminder strip on product pages.

### Named Rules
**The One Ground Rule.** A surface carries one product colour as its ground, never two side by side. The other products appear only as markers (discs, dots, category text) on white.

**The White Relief Rule.** On a product ground, text and controls are white, or a white card holding ink. Haze is a secondary-text tint for night and ink only; it is not cleared for reading text on teal or raspberry.

**The Ink Anchor Rule.** The primary action is an ink pill on every surface, including on white cards over a product ground. Product colours are never a button fill.

## Typography

**Display Font:** Fredoka (with Nunito, sans-serif)
**Body Font:** Nunito (with system-ui, sans-serif)
**Bangla Font:** Baloo Da 2, weights 500 and 600

**Character:** Rounded, open and warm. Fredoka gives the wordmark and every control a friendly, sleeve-printed voice; Nunito keeps long reading calm; Baloo Da 2 shares the same rounded build so Bangla lines sit beside English as equals, never as a footnote.

### Hierarchy
- **Display** (700, 68px mobile, 104px small screens, clamp(104px, 10.5vw, 160px) desktop, line-height 0.86, -0.04em): The "BdREN AI" wordmark on the sleeve only.
- **Hero** (700, 60px to 72px, line-height 1): Product name on its product page; the Suite band headline (48px to 60px, line-height 0.95).
- **Headline** (700, 36px to 48px, tight leading and tracking, balanced wrap): Section headings across all pages.
- **Title** (700, 36px to 44px, line-height 1): Product names in the overview card and the products list.
- **Track** (500, 22px to 27px; 700 when chosen): Track names in the sleeve list, with the category at 15px medium.
- **Body** (400, 16px to 18px, line-height 1.625): Reading copy in Nunito, measures held to 34 to 60ch.
- **Label** (600, 15px to 16px, Fredoka): Buttons, nav links, track numbers.

### Named Rules
**The Rounded Voice Rule.** Anything the visitor reads as a name or presses as a control is set in Fredoka; anything they read as an explanation is Nunito.

**The Equal Bangla Rule.** Bangla text is marked `lang="bn"` and set in Baloo Da 2 at the size of the line it sits in (0.9em inside display-scale taglines), never as a smaller caption.

## Layout

A single 1240px container with 24px side gutters on every page. Sections run full-bleed in colour with vertical rhythm of 96px (112px from md). The sleeve fills the viewport height on desktop (100svh) and splits into a wide left column (1.25fr: wordmark, tagline, track list pinned to the bottom) and a narrow right column (0.75fr, min 320px: overview card and the clip control, bottom-aligned). Below 1024px it stacks, and the clip's fade becomes a flat 82% ground wash so text stays readable over the clip.

Lists are rows, not card grids where the content is a sequence: the products list is a three-column ruled row (identity, summary and points, link) that stacks on mobile; the four facts are a 1, 2, then 4-column strip divided by hairlines; joining steps are three columns divided by 2px hairlines. Feature details on product pages use a 1-2-3 column card grid with 20px gaps.

Breakpoints are Tailwind defaults (sm 640, md 768, lg 1024). Touch targets are at least 44px, buttons 48px, track rows 52px.

## Elevation & Depth

Flat by default. Depth comes from coloured fields meeting white and from the clip printed into the ground, not from shadow. Two shadows exist, both soft and ink-tinted, and both lift a white surface off something else.

### Shadow Vocabulary
- **Sleeve lift** (`box-shadow: 0 24px 50px -24px rgba(20,19,28,0.55)`): Only the white overview card on the sleeve, to separate it from the moving clip.
- **Menu lift** (Tailwind `shadow-lg`): The header's profile dropdown.

### Named Rules
**The Flat Field Rule.** Cards on white or ground use a 1px hairline border, never a shadow. A shadow is earned only by a white surface floating over a coloured or moving ground.

## Shapes

Soft and rounded throughout. Every button and the track-number discs are full pills or circles. Containers step up in radius with size: inputs 12px, small tiles and segmented controls 14px, cards 24px, the sleeve's overview card and the product-page screenshot frame 28px (top corners only on the frame). Rules are the other half of the form language: 2px ink rules between products, 2px white rules at 50% between tracks, 1px hairlines everywhere else. The logo is an ink tile with 8px corners holding a white "B".

## Components

### Buttons
Round, solid and confident; one ink voice for the main action.
- **Shape:** Full pill (9999px), minimum height 48px (52 to 54px for page-level CTAs), Fredoka 600.
- **Primary:** Ink fill, white text, 24px side padding; hovers to Midnight Blue over 300ms.
- **Outline:** 1px ink border, ink text; fills ink with white text on hover. For white grounds.
- **Outline on colour:** 2px white border, white text; fills white with ink text on hover. For product grounds, night and ink.
- **White pill:** White fill, ink text, hovers to fog. The header's "Sign in with BdREN" and "See pricing" on the Suite band.
- **Text link with arrow:** Fredoka 600 at 18px, 2px underline offset 4px, arrow nudges 4px right on hover; text shifts to deep blue.
- **Focus:** Global 3px ink outline offset 2px with a 5px white halo, legible on white, ink and every product ground.

### Cards / Containers
- **Corner Style:** 24px (card); 28px for the sleeve overview card.
- **Background:** White.
- **Shadow Strategy:** None on white or ground (see The Flat Field Rule); the sleeve lift on the overview card only.
- **Border:** 1px hairline; hovers to ink where the card is a link.
- **Internal Padding:** 28px (24px for compact link cards).

### Inputs / Fields
- **Style:** White fill, 1px field-stroke border, 12px corners, 52px minimum height, 16px side padding, ink text, slate placeholder.
- **Focus:** The global ink ring with white halo.

### Navigation
- **Header:** Logo left, Fredoka 500 links, sign-in or profile pill right, 72px minimum height. On the home sleeve and product heroes it is transparent over the ground; elsewhere it sits on night with a night-line bottom rule. Links are fog, turning white with a 2px white underline on hover and when current. On mobile the links wrap to a full-width second row.
- **Profile pill:** 44px pill with a night-stroke outline, avatar, name and chevron; opens a white 16px-corner menu with 48px rows that hover to ground.
- **In-page nav (product pages):** Sticky white bar with a hairline bottom, 15px slate links turning ink on hover.
- **Footer:** Ink field, haze links turning white, four columns collapsing to two and one, a white rule at 15% above the copyright.

### The Sleeve (signature)
The home hero. The section's background is the `--ground` custom property (registered with `@property` so it animates), set inline to the chosen product's colour. The clip sits behind it in grayscale (contrast 0.8, brightness 1.3) at 55% opacity, multiplied by the ground, and a ground-to-transparent fade (solid to 45%, clear by 68%) keeps the wordmark and tracks on flat colour.
- **Track list:** Ordered list of buttons with `aria-pressed`; each row is a 28px circled number, the product name and its category, between 2px white rules at 50%. Rows are white at 78%; hover and the chosen track turn full white and indent 10px; the chosen disc fills white with the number in the ground colour, and the name goes bold.
- **Overview card:** White, 28px corners, sleeve lift, max 400px on desktop: product name, summary, three ticked points, ink "Open <product>" pill. Content lifts in (10px rise and fade, 450ms) on each change; the card is `aria-live="polite"`.
- **Clip control:** 48px circular white-outline button that pauses and plays the clip, shown only once a clip has loaded, with the sample-clip caption beside it while clips are placeholders.
- **Motion:** Ground cross-fade 700ms, clip fade 800ms, all on `cubic-bezier(0.16, 1, 0.3, 1)`. Under reduced motion every transition and the lift-in stop, and the clip loads paused.

### Product Hero
Each product page opens on its own colour with the header transparent over it: breadcrumb, product name in white Fredoka (60px to 72px), intro paragraph, an ink "See plans" pill and a white-outline "Book a demo" pill, then a 28px top-cornered frame (2px white border at 40%, white at 10% fill) for the product screenshot.

## Do's and Don'ts

### Do:
- **Do** give each product exactly one flat ground and keep the other three as markers on white (The One Ground Rule).
- **Do** set text on a product ground in white; use haze only on night and ink.
- **Do** make the primary action an ink pill, with deep-blue hover, on every surface.
- **Do** use Fredoka for names and controls, Nunito for explanations, and Baloo Da 2 with `lang="bn"` for every Bangla line.
- **Do** separate cards on white with a 1px hairline and list sequences with 2px rules instead of shadows.
- **Do** read a product's colour from `content/products.ts` rather than hard-coding it in a component.
- **Do** caption any placeholder clip or image as a sample on the page, and give every moving clip a pause control and a reduced-motion stop.

### Don't:
- **Don't** fill a button with a product colour or set long reading text in a product colour.
- **Don't** blend between two hues; the only gradient in the world is the sleeve's same-colour fade from ground to clear.
- **Don't** put a shadow on a card that sits on white or ground.
- **Don't** use sharp corners on controls or containers; nothing interactive is square.
- **Don't** set Bangla smaller than the English beside it or in the Latin fonts.

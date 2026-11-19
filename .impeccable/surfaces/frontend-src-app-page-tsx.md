---
version: 1
slug: "frontend-src-app-page-tsx"
primary_target: "frontend/src/app/page.tsx"
related_targets: ["frontend/src/components/home/Sleeve.tsx","frontend/src/components/site/Header.tsx","frontend/src/components/site/Footer.tsx"]
---

# Home page (bdren.ai)

Scope: the public home page; its theme (colour, type, buttons, header, footer) carries to every site page. Mode: Persuade.
Audience: institution decision-makers and individual staff/students, equally. Action: explore the four products and open one.
Proof on hand: real product facts only (PRODUCT.md). No testimonials, numbers or real product footage exist; the hero clips in frontend/public/videos are placeholders with no text burned in, captioned on the page as "Sample clip, not product footage" (SAMPLE_CLIPS in Sleeve.tsx), provenance in .impeccable/assets/videos-provenance.json.
History: the Prospectus direction was built first, then replaced by this one at the owner's request (2026-11-19). Owner changed Synapse's orange ground to deep blue.

## Direction contract

THESIS: the four products as a four-track record sleeve: one flat saturated ground per product, a huge rounded wordmark, the products as a short track list. Refuses the dark-hero-plus-card-grid software page.
OWN-WORLD: flat product grounds that carry white text at AA (Synapse #1846C9 deep blue, Mindspear #0B7F80 teal, AI Mail Wizard #C92A5C raspberry, QuiGen #7B3FC4 violet); white is the only relief colour; ink #14131C for primary pills and the footer. Fredoka for display and controls, Nunito for reading, Baloo Da 2 for Bangla. Pill buttons, soft 24-28px corners, ruled track rows.
STORY: visitor sees the sleeve (what it is, for whom, one account, Bangla and English), picks a track and reads its overview card, opens the product; below, a four-fact strip (one account, data kept apart per institution, Bangla and English, Suite or single product: the trust points the sleeve leaves out), the products as ruled tracks with colour markers, how an institution joins, and the Suite offer on deep blue.
FIRST VIEWPORT: the whole screen is the chosen product's ground with that product's clip printed into it (grayscale, multiplied by the ground). Left: "BdREN AI" in huge Fredoka, the tagline with a Bangla line, the four-track list at the bottom. Right: a white overview card (name, summary, three points, ink "Open <product>" pill) with a pause/play control. Transparent header over the ground with a white sign-in pill.
FORM: dealt challenger posters-covers-sleeves-yeye-pop-sleeve (verdict competitive), chosen by the owner over the Prospectus pick; seed: 3e18f17c466742c2
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature interaction: choosing a track cross-fades the ground colour (0.7s), swaps the clip, and lifts the card text in; the chosen track indents. Clips never autoplay under reduced motion and can always be paused.

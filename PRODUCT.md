# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, weighted equally (confirmed 2026-11-19):

- Institution decision-makers in Bangladesh: vice-chancellors, registrars, IT heads and office heads deciding whether their university, research institute or office adopts BdREN AI.
- Individual staff and students: teachers, researchers, students and office staff who sign up and use the products themselves.

## Product Purpose

BdREN AI is the public home for the AI products of BdREN, the Bangladesh Research and Education Network. The website presents every product, each with its own page, plus pricing, about and contact, and gives one account (sign-in and sign-up) for all of them. The first thing a visitor should do on the home page is explore the products and open the one they need.

## Positioning

AI tools from the national research and education network itself: one BdREN account for every product, each institution's data kept apart from every other, working in Bangla and English, with plans for individuals and whole institutions.

## Operating Context

- Products (four, 2026-11): Synapse (AI workspace for offices, universities and research institutions; includes Synapse Browser as a built-in feature, not a separate product), Mindspear (turns any PPTX or PDF into a playful quiz game played live by a class or group, with a live leaderboard), AI Mail Wizard (email assistant in Roundcube and Gmail), QuiGen (same starting point as Mindspear, a PPTX or PDF, but it creates a quiz to set and mark, not a game). Mindspear and QuiGen descriptions confirmed by the owner 2026-11-19; the earlier "research assistant with quests and assessments" wording for Mindspear was wrong.
- Sign-in is central (ZITADEL at auth.bdren.ai) and shared by all products. Universities can connect their own login.
- Institutions are onboarded by BdREN; members can ask to join an institution at sign-up and an admin approves.

## Capabilities and Constraints

- Packages: the BdREN AI Suite (all products in one plan) leads; each product can also be sold on its own. Institution pool and custom contracts exist.
- Stack: Next.js 14 app router, Tailwind, in `frontend/`; Django API under `/api/`.
- Undecided / not yet supplied: all prices, Mindspear feature details beyond the above (question types, player limits), QuiGen plan names and limits, contact phone and address, founding facts, legal page links.
- The Team section was removed from the site on 2026-11-18 by request.

## Brand Commitments

- Name: "BdREN AI" (BdREN with a lower-case d). Product names as listed above.
- No visual element of the earlier site is binding: colours, type, layout and wording may all change (confirmed 2026-11-19). Product facts must stay true.
- Motion: subtle only, never bulky.
- Existing logo artwork: `deploy/zitadel/branding/` (icon.svg, logo-dark.svg, logo-light.svg).

## Evidence on Hand

- Synapse and AI Mail Wizard feature copy from BdREN's Service Overview document.
- Synapse plan names and audiences (Starter, Standard, Pro, Business, Institution pool, Custom) from the pricing workbook.
- No testimonials, customer logos, usage numbers, benchmarks or product screenshots have been supplied. Do not fabricate them.

## Product Principles

1. One account, many products: the site should always make moving between products feel like one place.
2. Institutions own their data; say so plainly and never blur it.
3. Built for local work: Bangla and English, official letters, scanned forms.
4. Honest about what is undecided: placeholders are bracketed, never invented.

## Accessibility & Inclusion

Readable at phone width; text contrast at least 4.5:1; controls usable by keyboard. Many visitors read English as a second language, so wording stays plain.

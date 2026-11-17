import type { ProductSlug } from "./products";

export interface Plan {
  name: string;
  who: string;
  price: string;
  period: string;
  features: string[];
  cta: string;
  highlight?: boolean;
}

export interface Listing {
  id: "suite" | ProductSlug;
  label: string;
  rowHead: string;
  blurb: string;
  plans: Plan[];
  rows: { label: string; cells: string[] }[];
}

const PRICE = "[BDT —]";
const PER_PERSON = "per person / month";
const PER_INSTITUTION = "per institution / month";

export const SUITE: Listing = {
  id: "suite",
  label: "BdREN AI Suite",
  rowHead: "Included",
  blurb: "All four products under one plan and one bill.",
  plans: [
    {
      name: "Suite Starter",
      who: "Students and light users",
      price: PRICE,
      period: PER_PERSON,
      features: ["All 4 products", "Light allowance in each", "One sign-in, one bill"],
      cta: "Choose Suite Starter",
    },
    {
      name: "Suite Standard",
      who: "Faculty and regular staff",
      price: PRICE,
      period: PER_PERSON,
      features: ["All 4 products", "Regular allowance in each", "Synapse Browser included"],
      cta: "Choose Suite Standard",
    },
    {
      name: "Suite Pro",
      who: "Researchers and power users",
      price: PRICE,
      period: PER_PERSON,
      features: ["All 4 products", "Heavy-use allowance", "Specialist research skills"],
      cta: "Choose Suite Pro",
      highlight: true,
    },
    {
      name: "Suite Business",
      who: "Departments and heavy professional use",
      price: PRICE,
      period: PER_PERSON,
      features: ["All 4 products", "Twice the Pro allowance", "[Support level]"],
      cta: "Choose Suite Business",
    },
  ],
  rows: [
    { label: "Synapse (with Synapse Browser)", cells: ["Light", "Regular", "Heavy", "2× Heavy"] },
    { label: "Mindspear", cells: ["[—]", "[—]", "[—]", "[—]"] },
    { label: "AI Mail Wizard", cells: ["[—]", "[—]", "[—]", "[—]"] },
    { label: "QuiGen", cells: ["[—]", "[—]", "[—]", "[—]"] },
    { label: "Price vs buying each product", cells: ["[Save —%]", "[Save —%]", "[Save —%]", "[Save —%]"] },
  ],
};

export const PRODUCT_LISTINGS: Listing[] = [
  {
    id: "synapse",
    label: "Synapse",
    rowHead: "Feature",
    blurb: "The AI workspace: chat, documents, Scan to Word, the knowledge base and the built-in Synapse Browser.",
    plans: [
      {
        name: "Starter",
        who: "Students and light users",
        price: PRICE,
        period: PER_PERSON,
        features: ["All Synapse features", "Light monthly allowance", "Bangla and English"],
        cta: "Choose Starter",
      },
      {
        name: "Standard",
        who: "Faculty and regular staff",
        price: PRICE,
        period: PER_PERSON,
        features: ["Everything in Starter", "Regular monthly allowance", "Synapse Browser"],
        cta: "Choose Standard",
      },
      {
        name: "Pro",
        who: "Researchers and power users",
        price: PRICE,
        period: PER_PERSON,
        features: ["Everything in Standard", "Heavy-use allowance", "Specialist research skills"],
        cta: "Choose Pro",
        highlight: true,
      },
      {
        name: "Business",
        who: "Departments and heavy professional use",
        price: PRICE,
        period: PER_PERSON,
        features: ["Everything in Pro", "Twice the Pro allowance", "[Support level]"],
        cta: "Choose Business",
      },
    ],
    rows: [
      { label: "Monthly allowance", cells: ["Light", "Regular", "Heavy", "2× Heavy"] },
      { label: "Office Assistant", cells: ["Yes", "Yes", "Yes", "Yes"] },
      { label: "Synapse Browser", cells: ["[—]", "Yes", "Yes", "Yes"] },
      { label: "Knowledge base answers", cells: ["Yes", "Yes", "Yes", "Yes"] },
    ],
  },
  {
    id: "mindspear",
    label: "Mindspear",
    rowHead: "Feature",
    blurb: "AI research assistant with quests and assessments for universities and researchers.",
    plans: [
      {
        name: "Starter",
        who: "Individual researchers",
        price: PRICE,
        period: PER_PERSON,
        features: ["[Feature]", "[Feature]", "[Feature]"],
        cta: "Choose Starter",
      },
      {
        name: "Professional",
        who: "Research groups",
        price: PRICE,
        period: PER_PERSON,
        features: ["[Feature]", "[Feature]", "[Feature]"],
        cta: "Choose Professional",
        highlight: true,
      },
      {
        name: "Institutional",
        who: "Universities",
        price: PRICE,
        period: PER_INSTITUTION,
        features: ["[Feature]", "[Feature]", "[Feature]"],
        cta: "Get a quote",
      },
    ],
    rows: [
      { label: "[Feature]", cells: ["[—]", "[—]", "[—]"] },
      { label: "[Feature]", cells: ["[—]", "[—]", "[—]"] },
    ],
  },
  {
    id: "mail-wizard",
    label: "AI Mail Wizard",
    rowHead: "Feature",
    blurb: "Email help in Roundcube and Gmail: smart replies, formal emails, summaries and translation.",
    plans: [
      {
        name: "Individual",
        who: "One mailbox",
        price: PRICE,
        period: PER_PERSON,
        features: ["Smart replies from the thread", "Formal emails from a few details", "Summaries and translation"],
        cta: "Get Mail Wizard",
      },
      {
        name: "Institution",
        who: "Every mailbox on your domain",
        price: PRICE,
        period: PER_INSTITUTION,
        features: ["Everything in Individual", "Roundcube and Gmail", "Admin-managed access"],
        cta: "Get a quote",
        highlight: true,
      },
    ],
    rows: [
      { label: "Smart replies", cells: ["Yes", "Yes"] },
      { label: "Summaries and translation", cells: ["Yes", "Yes"] },
      { label: "Admin-managed access", cells: ["No", "Yes"] },
    ],
  },
  {
    id: "quigen",
    label: "QuiGen",
    rowHead: "Feature",
    blurb: "Generates quizzes from a topic, your files or class material.",
    plans: [
      {
        name: "[Plan]",
        who: "Individual teachers",
        price: PRICE,
        period: PER_PERSON,
        features: ["Quizzes from a topic", "Quizzes from your files", "[Quizzes per month]"],
        cta: "Choose plan",
      },
      {
        name: "[Plan]",
        who: "Departments",
        price: PRICE,
        period: PER_PERSON,
        features: ["Everything in [Plan]", "[Higher quiz limit]", "[Larger files]"],
        cta: "Choose plan",
        highlight: true,
      },
      {
        name: "Institution",
        who: "Universities and schools",
        price: PRICE,
        period: PER_INSTITUTION,
        features: ["Quizzes from topics and files", "Shared institution budget", "Admin-managed access"],
        cta: "Get a quote",
      },
    ],
    rows: [
      { label: "Quizzes from a topic", cells: ["Yes", "Yes", "Yes"] },
      { label: "Quizzes from your files", cells: ["Yes", "Yes", "Yes"] },
      { label: "Quizzes per month", cells: ["[—]", "[—]", "[—]"] },
    ],
  },
];

const LISTING_BY_ID = new Map<string, Listing>(PRODUCT_LISTINGS.map((l) => [l.id, l]));

export function getListing(id: string): Listing | undefined {
  return LISTING_BY_ID.get(id);
}

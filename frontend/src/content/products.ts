export type ProductSlug = "synapse" | "mindspear" | "mail-wizard" | "quigen";

export interface TextItem {
  title: string;
  body: string;
}

export interface Product {
  slug: ProductSlug;
  name: string;
  initial: string;
  category: string;
  summary: string;
  line: string;
  intro: string;
  featuresTitle: string;
  features: TextItem[];
  builtIn?: TextItem & { eyebrow: string };
  admin?: { title: string; intro: string; items: TextItem[] };
  faqs: { q: string; a: string }[];
  screenshot: string;
}

export const PRODUCTS: Product[] = [
  {
    slug: "synapse",
    name: "Synapse",
    initial: "S",
    category: "AI workspace",
    summary:
      "BdREN's AI workspace for offices, universities and research institutions, built on leading AI models with custom agents for specialised work.",
    line: "AI workspace, with Synapse Browser",
    intro:
      "The AI workspace for offices, universities and research institutions. Draft letters, rebuild scanned pages, search your own documents and manage it all per institution.",
    featuresTitle: "Everyday office work, done faster",
    features: [
      { title: "Office Assistant", body: "Emails, reports, letters and decks from scratch. Edits your Word, Excel and PowerPoint files." },
      { title: "Scan to Word", body: "Rebuilds scanned pages as editable Word files, keeping layout, tables, signatures and stamps." },
      { title: "Form filling", body: "Fills PDF and Word forms using data from your Excel or CSV files." },
      {
        title: "Specialist skills",
        body: "Academic writing with citation checks, exam papers and answer keys, LaTeX, statistics in plain language.",
      },
      { title: "Web search with sources", body: "Searches and reads the web for current information, and cites where each answer came from." },
      { title: "Images from a description", body: "Creates images and visuals for posters, slides and notices from a few words." },
    ],
    builtIn: {
      eyebrow: "Built into Synapse",
      title: "Synapse Browser",
      body: "Synapse can do web work for you in your own browser: it fills online forms from your files and stops for your approval before anything is submitted.",
    },
    admin: {
      title: "Your institution, under your control",
      intro: "An admin console for members, plans, features and announcements.",
      items: [
        { title: "Separate by design", body: "Members, chats, files and knowledge base never mix with another institution's." },
        { title: "Members and roles", body: "Add, remove and manage people, and end access with your own message." },
        { title: "Usage and limits", body: "Spending per institution and per member, with weekly and monthly quotas." },
        { title: "Knowledge base", body: "Upload policies and handbooks; answers cite the document and page." },
      ],
    },
    faqs: [
      {
        q: "Can other institutions see our chats or files?",
        a: "No. Each institution's members, chats, files and knowledge base are kept fully separate.",
      },
      { q: "Does it work in Bangla?", a: "Yes. You can write, read scans and search documents in Bangla and English." },
      {
        q: "Can Synapse answer from our own policies?",
        a: "Yes. Admins upload policies and handbooks to the institution knowledge base, and answers cite the document and page.",
      },
      { q: "How is usage limited?", a: "Each plan has weekly and monthly limits. Admins see usage and spending per member." },
    ],
    screenshot: "Synapse chat with a document open",
  },
  {
    slug: "mindspear",
    name: "Mindspear",
    initial: "M",
    category: "Research & assessment",
    summary: "AI research assistant with quests and assessments for universities and researchers.",
    line: "Research and assessment",
    intro: "An AI research assistant with quests and assessments, built for universities and researchers.",
    featuresTitle: "Research help for universities",
    features: [
      { title: "Research assistant", body: "[Describe how Mindspear helps with research.]" },
      { title: "Quests", body: "[Describe Mindspear quests.]" },
      { title: "Assessments", body: "[Describe Mindspear assessments.]" },
    ],
    faqs: [{ q: "[Question about Mindspear]", a: "[Answer.]" }],
    screenshot: "Mindspear research workspace",
  },
  {
    slug: "mail-wizard",
    name: "AI Mail Wizard",
    initial: "A",
    category: "Email assistant",
    summary:
      "Smart replies from the whole thread, formal emails from a few details, summaries and translation. Works in Roundcube and Gmail.",
    line: "Email replies and summaries",
    intro:
      "BdREN's AI email assistant. It writes and replies to email with smart suggestions, inside Roundcube webmail and Gmail.",
    featuresTitle: "Email, written faster",
    features: [
      { title: "Smart replies", body: "Writes natural, human-sounding replies based on the full email thread and its context." },
      {
        title: "Formal emails without prompting",
        body: "Fill in a few key details and get a complete, formal email.",
      },
      { title: "Summaries and translation", body: "Condenses long conversations and translates them instantly." },
      {
        title: "Where you already work",
        body: "Integrated with Roundcube webmail and available on the Google Workspace Marketplace for Gmail.",
      },
    ],
    faqs: [
      { q: "Which email apps does it work with?", a: "Roundcube webmail, and Gmail through the Google Workspace Marketplace." },
    ],
    screenshot: "AI Mail Wizard suggesting a reply in Roundcube",
  },
  {
    slug: "quigen",
    name: "QuiGen",
    initial: "Q",
    category: "Quiz generator",
    summary: "Generates quizzes from a topic, your files or class material, ready for teachers to review and use.",
    line: "Quizzes from topics and files",
    intro: "Generate quizzes from a topic, your files or class material, then review and use them with your students.",
    featuresTitle: "Quizzes in minutes",
    features: [
      { title: "From a topic", body: "Name a topic and get a quiz to review and edit." },
      { title: "From your files", body: "Upload lecture notes or documents and QuiGen builds questions from them." },
      { title: "[Question types]", body: "[List the question types QuiGen supports.]" },
    ],
    faqs: [{ q: "What can QuiGen make quizzes from?", a: "A topic, your files or class material." }],
    screenshot: "QuiGen building a quiz from lecture notes",
  },
];

const BY_SLUG = new Map<string, Product>(PRODUCTS.map((p) => [p.slug, p]));

export function getProduct(slug: string): Product | undefined {
  return BY_SLUG.get(slug);
}

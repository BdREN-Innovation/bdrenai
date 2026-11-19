export type ProductSlug = "synapse" | "mindspear" | "mail-wizard" | "quigen";

export interface TextItem {
  title: string;
  body: string;
}

export interface Product {
  slug: ProductSlug;
  name: string;
  initial: string;
  /** The product's flat ground on the home page sleeve; white text passes AA on every one. */
  color: string;
  category: string;
  summary: string;
  /** Three short lines for the home page chapter list. */
  points: string[];
  line: string;
  intro: string;
  featuresTitle: string;
  features: TextItem[];
  builtIn?: TextItem;
  admin?: { title: string; intro: string; items: TextItem[] };
  faqs: { q: string; a: string }[];
  screenshot: string;
}

export const PRODUCTS: Product[] = [
  {
    slug: "synapse",
    name: "Synapse",
    initial: "S",
    color: "#1846C9",
    category: "AI workspace",
    summary:
      "BdREN's AI workspace for offices, universities and research institutions, built on leading AI models with custom agents for specialised work.",
    points: [
      "Letters, reports and decks; edits Word, Excel and PowerPoint",
      "Scanned pages become editable Word files",
      "Answers from your institution's own policies, with page citations",
    ],
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
    color: "#0B7F80",
    category: "Live quiz games",
    summary: "Turns any PowerPoint or PDF into a playful quiz game for a class or group, with a live leaderboard.",
    points: ["Upload a PPTX or PDF and get a game", "Everyone plays together, live", "A live leaderboard as the game runs"],
    line: "Live quiz games from your slides",
    intro: "Turn any PowerPoint or PDF into a playful quiz game. Your class or group plays together, live, with a leaderboard on screen.",
    featuresTitle: "Your slides, played as a game",
    features: [
      { title: "From your PPTX or PDF", body: "Upload the slides or document you already teach from, and Mindspear turns it into a quiz game." },
      { title: "Played together, live", body: "The whole class or group plays at the same time." },
      { title: "Live leaderboard", body: "Scores update on a leaderboard as the game runs." },
    ],
    faqs: [
      { q: "What can Mindspear make a game from?", a: "Any PowerPoint (PPTX) or PDF." },
      { q: "How is it different from QuiGen?", a: "Mindspear makes a game the group plays live, with a leaderboard. QuiGen makes a quiz to set and mark." },
    ],
    screenshot: "Mindspear's live leaderboard during a class game",
  },
  {
    slug: "mail-wizard",
    name: "AI Mail Wizard",
    initial: "A",
    color: "#C92A5C",
    category: "Email assistant",
    summary:
      "Smart replies from the whole thread, formal emails from a few details, summaries and translation. Works in Roundcube and Gmail.",
    points: ["Replies written from the whole thread", "Formal emails from a few details", "Summaries and translation"],
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
    color: "#7B3FC4",
    category: "Quiz maker",
    summary: "Creates a quiz from your PowerPoint or PDF. A quiz to set and mark, not a game.",
    points: ["Upload a PPTX or PDF and get a quiz", "Questions drawn from your own material", "Ready for teachers to review"],
    line: "Quizzes from your slides and PDFs",
    intro: "Turn your PowerPoint or PDF into a quiz, then review it and set it for your students.",
    featuresTitle: "A quiz from what you already teach",
    features: [
      { title: "From your PPTX or PDF", body: "Upload your slides or document and QuiGen builds questions from it." },
      { title: "Ready to review", body: "Read and edit the questions before you set the quiz." },
      { title: "[Question types]", body: "[List the question types QuiGen supports.]" },
    ],
    faqs: [
      { q: "What can QuiGen make quizzes from?", a: "A PowerPoint (PPTX) or PDF." },
      { q: "How is it different from Mindspear?", a: "QuiGen makes a quiz to set and mark. Mindspear turns the same files into a live game with a leaderboard." },
    ],
    screenshot: "QuiGen building a quiz from lecture slides",
  },
];

const BY_SLUG = new Map<string, Product>(PRODUCTS.map((p) => [p.slug, p]));

export function getProduct(slug: string): Product | undefined {
  return BY_SLUG.get(slug);
}

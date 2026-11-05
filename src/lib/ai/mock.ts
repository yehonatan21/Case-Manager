/**
 * Offline, deterministic AI engine. Used when no AI provider is configured so the whole
 * product works end-to-end in development and demos. It is intentionally simple:
 * keyword-based classification, a question bank, and template-based drafting.
 */
import type { IntakeChatMessage, IntakeSummary, PriceListItem, ServiceTemplate } from "../db/schema";
import type { ServiceCategory } from "../domain";
import { dictionaries } from "../i18n/dictionaries";
import { fmt } from "../i18n/config";
import type { CaseSummaryOutput, DocAnalysis, IntakeTurn, QuoteDraft, TaskPlan, TextTool } from "./schemas";

type L = "he" | "en";
type Q = { id: string; label: [string, string]; text: [string, string]; replies?: [string[], string[]] };

const pick = (l: L, pair: [string, string]) => (l === "he" ? pair[0] : pair[1]);
const pickArr = (l: L, pair?: [string[], string[]]) => (pair ? (l === "he" ? pair[0] : pair[1]) : []);

const KEYWORDS: [ServiceCategory, string[]][] = [
  ["citizenship", ["אזרחות", "דרכון", "citizenship", "passport", "naturaliz"]],
  ["immigration_visa", ["ויזה", "אשרה", "visa", "green card", "גרין קארד", "work permit", "אשרת עבודה", "residence permit"]],
  ["relocation", ["לעבור", "מעבר ל", "רילוקיישן", "להגר", "הגירה", "לחו\"ל", "לחו״ל", "relocat", "move to", "moving to", "move abroad", "moving abroad", "live abroad", "emigrat", "immigrat"]],
  ["business_setup", ["עסק", "חברה", "סטארט", "עוסק", "business", "company", "startup", "incorporat", "subsidiary", "חברה בת"]],
  ["legal_consulting", ["עורך דין", "עו\"ד", "משפטי", "חוזה", "תביעה", "legal", "lawyer", "contract", "lawsuit"]],
  ["tax_finance", ["מס ", "מיסוי", "מס הכנסה", "דוח שנתי", "tax", "accounting", "פיננס", "finance"]],
  ["real_estate", ["דירה", "נדל\"ן", "נדל״ן", "נכס", "משכנתא", "apartment", "property", "real estate", "mortgage"]],
  ["documents_translation", ["תרגום", "אפוסטיל", "נוטריון", "translation", "apostille", "notar", "תעודת לידה", "birth certificate"]],
];

const COUNTRIES: [string, string, string[]][] = [
  ["גרמניה", "Germany", ["גרמניה", "germany", "german", "ברלין", "berlin"]],
  ["פורטוגל", "Portugal", ["פורטוגל", "portugal", "portuguese", "ליסבון", "lisbon"]],
  ["ספרד", "Spain", ["ספרד", "spain", "spanish"]],
  ["פולין", "Poland", ["פולין", "poland", "polish"]],
  ["אוסטריה", "Austria", ["אוסטריה", "austria"]],
  ["צרפת", "France", ["צרפת", "france", "french", "פריז", "paris"]],
  ["איטליה", "Italy", ["איטליה", "italy", "italian"]],
  ["יוון", "Greece", ["יוון", "greece", "greek"]],
  ["הונגריה", "Hungary", ["הונגריה", "hungary"]],
  ["רומניה", "Romania", ["רומניה", "romania"]],
  ["הולנד", "Netherlands", ["הולנד", "netherlands", "holland", "dutch", "אמסטרדם", "amsterdam"]],
  ["בריטניה", "United Kingdom", ["בריטניה", "אנגליה", "לונדון", "united kingdom", "england", "london", " uk"]],
  ["ארצות הברית", "United States", ["ארה\"ב", "ארה״ב", "ארצות הברית", "אמריקה", "usa", "united states", "america"]],
  ["קנדה", "Canada", ["קנדה", "canada"]],
  ["אוסטרליה", "Australia", ["אוסטרליה", "australia"]],
  ["קפריסין", "Cyprus", ["קפריסין", "cyprus"]],
  ["אירלנד", "Ireland", ["אירלנד", "ireland"]],
  ["צ'כיה", "Czech Republic", ["צ'כיה", "czech", "פראג", "prague"]],
  ["ישראל", "Israel", ["ישראל", "israel"]],
];

const GENERIC: Q[] = [
  { id: "goal", label: ["מטרה", "Goal"], text: ["מה התוצאה העיקרית שהיית רוצה להשיג?", "What's the main outcome you'd like to achieve?"] },
  {
    id: "people",
    label: ["מספר מעורבים", "People involved"],
    text: ["כמה אנשים מעורבים בבקשה?", "How many people are involved in this request?"],
    replies: [["רק אני", "2", "3–4", "5 ומעלה"], ["Just me", "2", "3–4", "5 or more"]],
  },
  {
    id: "deadline",
    label: ["תאריך יעד", "Target date"],
    text: ["האם יש תאריך יעד או מועד חשוב שכדאי שנדע עליו?", "Is there a target date or deadline we should know about?"],
    replies: [["בחודש הקרוב", "בתוך חצי שנה", "בתוך שנה", "אין תאריך יעד"], ["Within a month", "Within 6 months", "Within a year", "No deadline"]],
  },
  {
    id: "started",
    label: ["תהליך קודם", "Previous steps"],
    text: ["האם כבר התחלתם תהליך כלשהו בנושא?", "Have you already started any process on this?"],
    replies: [["עוד לא", "כן, התחלתי", "התחלתי ונתקעתי"], ["Not yet", "Yes, I started", "Started and got stuck"]],
  },
  {
    id: "extra",
    label: ["מידע נוסף", "Additional information"],
    text: ["יש עוד משהו שחשוב שהצוות ידע? אפשר גם לצרף מסמך רלוונטי או לדלג.", "Anything else the team should know? You can also attach a relevant document, or skip."],
  },
];

const SPECIFIC: Partial<Record<ServiceCategory, Q[]>> = {
  relocation: [
    {
      id: "country",
      label: ["מדינת יעד", "Destination country"],
      text: ["האם כבר יש מדינה מסוימת שאתם שוקלים?", "Is there a specific country you're considering?"],
      replies: [["עוד לא החלטנו", "יש כמה אפשרויות"], ["Not decided yet", "A few options"]],
    },
    {
      id: "purpose",
      label: ["מטרת המעבר", "Purpose of the move"],
      text: ["מה המטרה העיקרית של המעבר?", "What's the main purpose of the move?"],
      replies: [["עבודה", "לימודים", "איכות חיים", "משפחה"], ["Work", "Studies", "Quality of life", "Family"]],
    },
  ],
  citizenship: [
    { id: "country", label: ["מדינה", "Country"], text: ["לאיזו מדינה מדובר?", "Which country is this about?"] },
    {
      id: "basis",
      label: ["בסיס לזכאות", "Basis for eligibility"],
      text: ["על בסיס מה נראה לך שקיימת זכאות?", "What do you think the eligibility might be based on?"],
      replies: [["מוצא משפחתי", "מגורים", "נישואין", "לא בטוח"], ["Family ancestry", "Residence", "Marriage", "Not sure"]],
    },
  ],
  immigration_visa: [
    { id: "country", label: ["מדינה", "Country"], text: ["לאיזו מדינה נדרשת הוויזה?", "Which country is the visa for?"] },
    {
      id: "visa_type",
      label: ["סוג ויזה", "Visa type"],
      text: ["איזה סוג ויזה נדרש?", "What type of visa do you need?"],
      replies: [["תיירות", "עבודה", "לימודים", "לא בטוח"], ["Tourist", "Work", "Study", "Not sure"]],
    },
  ],
  business_setup: [
    {
      id: "stage",
      label: ["שלב העסק", "Business stage"],
      text: ["באיזה שלב נמצא העסק?", "What stage is the business at?"],
      replies: [["רעיון", "עסק קיים", "התרחבות"], ["Idea", "Existing business", "Expansion"]],
    },
    { id: "field", label: ["תחום פעילות", "Field of activity"], text: ["מה תחום הפעילות של העסק?", "What does the business do?"] },
    { id: "country", label: ["מדינה / אזור", "Country / region"], text: ["באיזו מדינה או אזור?", "In which country or region?"] },
  ],
  legal_consulting: [
    {
      id: "legal_area",
      label: ["תחום משפטי", "Legal area"],
      text: ["באיזה תחום מדובר?", "Which area is this about?"],
      replies: [["חוזים", "נדל״ן", "משפחה", "עבודה"], ["Contracts", "Real estate", "Family", "Employment"]],
    },
  ],
  tax_finance: [
    {
      id: "taxpayer",
      label: ["סוג נישום", "Taxpayer type"],
      text: ["האם מדובר באדם פרטי או בעסק?", "Is this for an individual or a business?"],
      replies: [["פרטי", "עסק"], ["Individual", "Business"]],
    },
    { id: "country", label: ["מדינה", "Country"], text: ["באיזו מדינה או מדינות?", "Which country or countries?"] },
  ],
  real_estate: [
    {
      id: "deal",
      label: ["סוג עסקה", "Transaction type"],
      text: ["האם מדובר ברכישה, מכירה או השכרה?", "Is this a purchase, sale or rental?"],
      replies: [["רכישה", "מכירה", "השכרה"], ["Purchase", "Sale", "Rental"]],
    },
    { id: "location", label: ["מיקום", "Location"], text: ["באיזה אזור נמצא הנכס?", "Where is the property located?"] },
  ],
  documents_translation: [
    { id: "doc_types", label: ["סוגי מסמכים", "Document types"], text: ["אילו מסמכים מדובר?", "Which documents are involved?"] },
    { id: "doc_purpose", label: ["יעד המסמכים", "Purpose"], text: ["לאיזו מדינה או מטרה המסמכים נדרשים?", "Which country or purpose are the documents for?"] },
  ],
};

const ACKS: [string[], string[]] = [["תודה, זה עוזר.", "הבנתי, תודה.", "מצוין."], ["Thanks, that helps.", "Got it, thank you.", "Great."]];

function lower(s: string) {
  return " " + s.toLowerCase() + " ";
}

export function detectCategory(text: string): ServiceCategory {
  const t = lower(text);
  let best: ServiceCategory = "other";
  let bestScore = 0;
  for (const [cat, words] of KEYWORDS) {
    const score = words.reduce((n, w) => n + (t.includes(w.toLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) {
      best = cat;
      bestScore = score;
    }
  }
  return best;
}

export function detectCountries(text: string, l: L): string[] {
  const t = lower(text);
  return COUNTRIES.filter(([, , words]) => words.some((w) => t.includes(w.toLowerCase()))).map(([h, e]) => (l === "he" ? h : e));
}

function isUnknown(m: IntakeChatMessage, l: L) {
  const d = dictionaries[l].intake;
  const c = m.content.trim();
  return m.skipped || c === d.dontKnow || c === d.skip || /^(לא יודע|לא יודעת|אין לי מושג|don'?t know|not sure|skip)$/i.test(c);
}

function bankFor(cat: ServiceCategory): Q[] {
  const specific = SPECIFIC[cat] ?? [];
  const generic = cat === "other" ? GENERIC : GENERIC.filter((q) => q.id !== "goal");
  return [...specific, ...generic];
}

type MockIntakeResult = IntakeTurn & { questionId?: string };

/** Questions whose answer is usually already in the customer's own words. */
const PREANSWERED: Record<string, RegExp> = {
  visa_type: /work|study|student|tourist|business visa|עבודה|לימוד|סטודנט|תייר/i,
  purpose: /for work|job offer|to study|quality of life|לצורך עבודה|ללימודים|איכות חיים/i,
  taxpayer: /company|business|personal|individual|חברה|עסק|פרטי/i,
  deal: /buy|sell|rent|purchase|לקנות|למכור|לשכור|רכישה|מכירה|השכרה/i,
};

/** Reply in the language the customer writes in (Hebrew vs. Latin script), defaulting to the UI locale. */
export function detectLanguage(text: string, fallback: L): L {
  const he = (text.match(/[\u0590-\u05FF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (he === 0 && latin >= 3) return "en";
  if (he > 0 && he >= latin / 2) return "he";
  return fallback;
}

export function mockIntakeTurn(opts: { messages: IntakeChatMessage[]; locale: L; limit: number; forceReady?: boolean }): MockIntakeResult {
  const userMsgs = opts.messages.filter((m) => m.role === "user");
  const allText = userMsgs.map((m) => m.content).join(" \n ");
  const l = detectLanguage(userMsgs[0]?.content ?? "", opts.locale);
  if (allText.includes("[simulate-ai-error]")) throw new Error("Simulated AI failure");

  const firstText = userMsgs[0]?.content ?? "";
  const category = detectCategory(allText);
  const bank = bankFor(category);

  // Pair each asked question with the customer's next answer.
  const answers = new Map<string, { q: Q; answer: IntakeChatMessage | null }>();
  const allQs = [...GENERIC, ...Object.values(SPECIFIC).flat()];
  opts.messages.forEach((m, i) => {
    if (m.role !== "assistant" || !m.qid) return;
    const q = allQs.find((x) => x.id === m.qid);
    if (!q) return;
    const next = opts.messages.slice(i + 1).find((x) => x.role === "user") ?? null;
    answers.set(q.id, { q, answer: next });
  });
  const askedCount = opts.messages.filter((m) => m.role === "assistant" && m.qid).length;

  const countries = detectCountries(allText, l);
  const facts: { label: string; value: string }[] = [];
  const missing: string[] = [];
  const constraints: string[] = [];
  for (const { q, answer } of answers.values()) {
    if (!answer || q.id === "extra") continue;
    if (isUnknown(answer, l)) missing.push(pick(l, q.label));
    else {
      facts.push({ label: pick(l, q.label), value: answer.content.trim().slice(0, 200) });
      if (q.id === "deadline" && !/אין תאריך|no deadline/i.test(answer.content)) constraints.push(answer.content.trim());
    }
  }
  if (countries.length && !answers.has("country")) facts.unshift({ label: l === "he" ? "מדינה" : "Country", value: countries.join(", ") });
  const needsCountry = ["relocation", "citizenship", "immigration_visa"].includes(category);
  const countryKnown = countries.length > 0 || (answers.get("country")?.answer && !isUnknown(answers.get("country")!.answer!, l));
  if (needsCountry && !countryKnown && !missing.includes(l === "he" ? "מדינה" : "Country")) {
    missing.push(l === "he" ? "מדינת יעד מועדפת" : "Preferred destination country");
  }

  const allLower = allText.toLowerCase();
  let urgency: IntakeSummary["urgency"] = "normal";
  if (/דחוף|בהקדם|מיידי|urgent|asap|immediately/.test(allLower)) urgency = "urgent";
  else if (/בחודש הקרוב|within a month|השבוע|this week/.test(allLower)) urgency = "high";

  const country = countries[0];
  const titles: Record<ServiceCategory, [string, string]> = {
    relocation: [country ? `בדיקת אפשרויות מעבר ל${country}` : "בדיקת אפשרויות מעבר למדינה אחרת", country ? `Exploring relocation to ${country}` : "Exploring relocation options"],
    citizenship: [country ? `בדיקת זכאות לאזרחות (${country})` : "בדיקת זכאות לאזרחות זרה", country ? `Citizenship eligibility check (${country})` : "Foreign citizenship eligibility check"],
    immigration_visa: [country ? `סיוע בבקשת ויזה (${country})` : "סיוע בהגשת בקשת ויזה", country ? `Visa application support (${country})` : "Visa application support"],
    business_setup: [country ? `ייעוץ להקמת עסק (${country})` : "ייעוץ להקמת עסק", country ? `Business setup consultation (${country})` : "Business setup consultation"],
    legal_consulting: ["ייעוץ משפטי", "Legal consultation"],
    tax_finance: ["ייעוץ מס ופיננסים", "Tax & finance consultation"],
    real_estate: ["ליווי בעסקת נדל״ן", "Real estate transaction support"],
    documents_translation: ["תרגום ואימות מסמכים", "Document translation & certification"],
    other: [firstText.slice(0, 60), firstText.slice(0, 60)],
  };
  const catLabel = dictionaries[l].categories[category];
  const extra = answers.get("extra")?.answer;
  const extraAnswer = extra && !isUnknown(extra, l) ? extra.content.trim() : "";
  const summary: IntakeSummary & { service_category: ServiceCategory } = {
    request_title: pick(l, titles[category]) || (l === "he" ? "בקשה חדשה" : "New request"),
    request_description: [firstText.trim(), extraAnswer].filter(Boolean).join("\n"),
    service_category: category,
    customer_goal: answers.get("goal")?.answer && !isUnknown(answers.get("goal")!.answer!, l) ? answers.get("goal")!.answer!.content : firstText.slice(0, 240),
    known_facts: facts,
    constraints,
    missing_information: missing,
    suggested_next_questions: [],
    urgency,
    needs_human_review: true,
    assumptions: [l === "he" ? `סוג השירות המוצע לבדיקה: ${catLabel}` : `Suggested service type to review: ${catLabel}`],
  };

  const firstLower = firstText.toLowerCase();
  const next = bank.find(
    (q) => !answers.has(q.id) && !(q.id === "country" && countries.length) && !PREANSWERED[q.id]?.test(firstLower),
  );
  const ready = opts.forceReady || !next || askedCount >= opts.limit;
  summary.suggested_next_questions = next ? [pick(l, next.text)] : [];

  if (ready) {
    return {
      reply:
        l === "he"
          ? "תודה! נראה שיש לנו תמונה טובה של הבקשה. אפשר לעבור עכשיו לסיכום, לבדוק ולתקן אותו — או להמשיך ולהוסיף פרטים."
          : "Thank you! It looks like we have a good picture of the request. You can move to the summary now, review and fix it — or keep adding details.",
      quick_replies: [],
      ready_for_review: true,
      summary: { ...summary, new_service_type: null },
    };
  }
  const intro =
    askedCount === 0
      ? l === "he"
        ? "אני יכול לעזור לך לארגן את הבקשה כדי שהצוות יבין מה נדרש."
        : "I can help you organise the request so the team understands what's needed."
      : pickArr(l, ACKS)[askedCount % 3]!;
  return {
    reply: `${intro} ${pick(l, next.text)}`,
    quick_replies: pickArr(l, next.replies),
    ready_for_review: false,
    summary: { ...summary, new_service_type: null },
    questionId: next.id,
  };
}

export function mockCaseSummary(opts: {
  locale: L;
  title: string;
  description: string;
  goal: string;
  status: string;
  intake: IntakeSummary | null;
  messages: { ref: string; fromClient: boolean; body: string }[];
  documents: { ref: string; title: string; status: string }[];
}): CaseSummaryOutput {
  const l = opts.locale;
  const known: CaseSummaryOutput["known_facts"] = (opts.intake?.known_facts ?? []).map((f) => ({ fact: `${f.label}: ${f.value}`, source_refs: ["INTAKE"] }));
  for (const m of opts.messages.filter((x) => x.fromClient).slice(-3)) {
    known.push({ fact: m.body.length > 140 ? m.body.slice(0, 139) + "…" : m.body, source_refs: [m.ref] });
  }
  for (const d of opts.documents.filter((x) => x.status !== "requested")) {
    known.push({ fact: l === "he" ? `הועלה מסמך: ${d.title}` : `Document uploaded: ${d.title}`, source_refs: [d.ref] });
  }
  const missing = [...(opts.intake?.missing_information ?? [])];
  for (const d of opts.documents.filter((x) => x.status === "requested" || x.status === "needs_new_version")) {
    missing.push(l === "he" ? `מסמך שטרם התקבל: ${d.title}` : `Document not yet received: ${d.title}`);
  }
  const text = `${opts.title} ${opts.description}`;
  const complexities: string[] = [];
  const countries = detectCountries(text, l);
  if (countries.length > 1) complexities.push(l === "he" ? `מעורבות של כמה מדינות (${countries.join(", ")})` : `Several countries involved (${countries.join(", ")})`);
  if ((opts.intake?.constraints ?? []).length) complexities.push(l === "he" ? `אילוץ זמן: ${opts.intake!.constraints.join("; ")}` : `Time constraint: ${opts.intake!.constraints.join("; ")}`);
  if (/רשויות|ממשל|authorit|government|consulate|קונסוליה/i.test(text)) complexities.push(l === "he" ? "תלות בגורמי ממשל חיצוניים" : "Dependency on external authorities");
  if (missing.length > 2) complexities.push(l === "he" ? "חסרים מספר פרטים מהותיים" : "Several material details are missing");

  const nextByStatus: Record<string, [string, string]> = {
    submitted: missing.length ? ["לשאול את הלקוח שאלה ממוקדת על: " + missing[0], "Ask the client a focused question about: " + missing[0]] : ["להכין טיוטת הצעת מחיר", "Prepare a draft quote"],
    under_review: missing.length ? ["לברר עם הלקוח: " + missing[0], "Clarify with the client: " + missing[0]] : ["להכין טיוטת הצעת מחיר", "Prepare a draft quote"],
    awaiting_information: ["להמתין לתשובת הלקוח ולתזכר אם אין מענה תוך יומיים", "Wait for the client's reply and follow up if there's no answer within two days"],
    quote_preparation: ["להשלים את התמחור ולשלוח את ההצעה", "Complete pricing and send the quote"],
    quote_sent: ["לעקוב אחר אישור ההצעה", "Follow up on quote approval"],
    awaiting_payment: ["לוודא שהלקוח השלים את התשלום", "Make sure the client completes the payment"],
    active: ["ליצור או לעדכן את רשימת המשימות ולעדכן את הלקוח", "Create or update the task list and update the client"],
    awaiting_client: ["לתזכר את הלקוח לגבי הפעולה הנדרשת", "Remind the client about the required action"],
  };
  const next = nextByStatus[opts.status] ?? ["לעבור על התיק ולעדכן את הלקוח", "Review the case and update the client"];
  return {
    what_client_wants: opts.goal || opts.title,
    known_facts: known.slice(0, 8),
    missing_information: missing.slice(0, 6),
    complexities: complexities.slice(0, 5),
    recommended_next_step: pick(l, next),
  };
}

export function mockQuoteDraft(opts: {
  locale: L;
  title: string;
  description: string;
  category: string;
  priceList: Pick<PriceListItem, "code" | "name" | "category">[];
}): QuoteDraft {
  const l = opts.locale;
  const matching = opts.priceList.filter((p) => p.category === opts.category).slice(0, 2);
  const items = (matching.length ? matching : opts.priceList.filter((p) => p.code === "CONSULT-INIT")).map((p) => ({
    description: p.name,
    quantity: 1,
    price_list_code: p.code,
  }));
  if (items.length === 0) items.push({ description: l === "he" ? "שירות מקצועי" : "Professional service", quantity: 1, price_list_code: null as unknown as string });
  return {
    service_name: opts.title,
    scope:
      l === "he"
        ? `בחינת הבקשה "${opts.title}", מיפוי האפשרויות, הכנת תוכנית פעולה וליווי בביצוע השלבים המוסכמים.`
        : `Review of the request "${opts.title}", mapping the options, preparing an action plan and supporting the agreed steps.`,
    included: items.map((i) => i.description),
    excluded: l === "he" ? ["אגרות ותשלומים לרשויות", "תרגומים ואימותים נוטריוניים, אלא אם צוין אחרת", "הוצאות נסיעה"] : ["Government fees and charges", "Notarised translations and certifications unless stated", "Travel expenses"],
    required_documents: [],
    items,
    payment_terms: l === "he" ? "תשלום מלא עם אישור ההצעה" : "Full payment upon approval of the quote",
    timeline_estimate: "",
    disclaimers:
      l === "he"
        ? ["ההצעה אינה מהווה התחייבות לתוצאת הליך מול רשויות או צדדים שלישיים.", "לוחות הזמנים תלויים בזמינות המסמכים ובגורמים חיצוניים."]
        : ["This quote does not guarantee the outcome of any process with authorities or third parties.", "Timelines depend on document availability and external parties."],
  };
}

export function mockTaskPlan(opts: { locale: L; category: string; templates: Pick<ServiceTemplate, "category" | "tasks">[] }): TaskPlan {
  const tpl = opts.templates.find((t) => t.category === opts.category);
  if (tpl && tpl.tasks.length) {
    return {
      tasks: tpl.tasks.map((t) => ({
        title: t.title,
        description: t.description ?? "",
        requires_client_action: !!t.requiresClientAction,
        due_in_days: t.dueInDays ?? null,
        priority: t.priority ?? "normal",
      })),
    };
  }
  const he = ["בדיקת המסמכים שהתקבלו", "בקשת השלמות מהלקוח", "הכנת המסמך או התוצר", "בדיקה פנימית", "העברת התוצר ללקוח", "סגירת התיק"];
  const en = ["Review the documents received", "Request missing items from the client", "Prepare the document or deliverable", "Internal review", "Deliver to the client", "Close the case"];
  const list = opts.locale === "he" ? he : en;
  return {
    tasks: list.map((title, i) => ({ title, description: "", requires_client_action: i === 1, due_in_days: [2, 3, 7, 9, 10, 12][i]!, priority: i === 3 ? "high" : "normal" })),
  };
}

export function mockTextTool(opts: {
  locale: L;
  tool: TextTool;
  input: string;
  targetLang?: L;
  customerName?: string;
  missing?: string[];
  status?: string;
  thread?: { from: string; body: string }[];
  openTasks?: string[];
}): string {
  const l = opts.locale;
  const name = opts.customerName ?? "";
  switch (opts.tool) {
    case "clarify_questions": {
      const qs = (opts.missing ?? []).slice(0, 3);
      if (l === "he") {
        return `שלום ${name},\nכדי שנוכל לבחון את הבקשה ולהכין הצעה מתאימה, נשמח לקבל כמה פרטים נוספים:\n${(qs.length ? qs : ["מהו מועד היעד?", "האם כבר התחלת תהליך קודם?"]).map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nתודה,\nהצוות`;
      }
      return `Hello ${name},\nTo review your request and prepare a suitable quote, we'd appreciate a few more details:\n${(qs.length ? qs : ["What is your target date?", "Have you already started any previous process?"]).map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nThank you,\nThe team`;
    }
    case "professional":
      return l === "he" ? `שלום ${name},\n\n${opts.input.trim()}\n\nנשמח לעמוד לרשותך בכל שאלה.\nבברכה,\nהצוות` : `Hello ${name},\n\n${opts.input.trim()}\n\nPlease let us know if you have any questions.\nBest regards,\nThe team`;
    case "shorten": {
      const sentences = opts.input.split(/(?<=[.!?])\s+/).filter(Boolean);
      return sentences.slice(0, 2).join(" ");
    }
    case "translate":
      return (l === "he" ? "[תרגום אוטומטי זמין רק עם ספק AI מוגדר]\n" : "[Automatic translation requires a configured AI provider]\n") + opts.input;
    case "summarize_thread":
      return (opts.thread ?? []).slice(-8).map((m) => `• ${m.from}: ${m.body.replace(/\s+/g, " ").slice(0, 120)}`).join("\n") || (l === "he" ? "אין הודעות לסכם." : "No messages to summarise.");
    case "status_update": {
      const statusLabel = opts.status ? dictionaries[l].status.client[opts.status as keyof (typeof dictionaries)["he"]["status"]["client"]] ?? opts.status : "";
      const tasks = (opts.openTasks ?? []).slice(0, 3);
      return l === "he"
        ? `שלום ${name},\nרצינו לעדכן שהתיק שלך נמצא כעת בסטטוס "${statusLabel}".${tasks.length ? `\nהשלבים הבאים: ${tasks.join(", ")}.` : ""}\nנמשיך לעדכן אותך בכל התקדמות.\n\nבברכה,\nהצוות`
        : `Hello ${name},\nA quick update: your case is currently "${statusLabel}".${tasks.length ? `\nNext steps: ${tasks.join(", ")}.` : ""}\nWe'll keep you posted on any progress.\n\nBest regards,\nThe team`;
    }
  }
}

export function mockDocAnalysis(locale: L): DocAnalysis {
  return {
    readable: false,
    summary: fmt(locale === "he" ? "ניתוח מסמכים אוטומטי זמין רק עם ספק AI מוגדר." : "Automatic document analysis requires a configured AI provider."),
    fields: [],
    notes: locale === "he" ? "המסמך סומן לבדיקה ידנית." : "The document was flagged for manual review.",
  };
}

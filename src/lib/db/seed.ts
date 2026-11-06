import { sql } from "drizzle-orm";
import type { Database } from "./index";
import * as s from "./schema";
import { env } from "../env";
import type { IntakeSummary } from "./schema";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000);
const daysFromNowIso = (d: number) => new Date(Date.now() + d * 86400 * 1000).toISOString().slice(0, 10);

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  company: {
    name: "Case Manager",
    email: "office@example.com",
    phone: "03-0000000",
  },
  vat_rate: 18,
  currency: "ILS",
  quote_validity_days: 14,
  first_response_sla_hours: 24,
  intake_question_limit: 7,
  /** Remind the client about documents still missing every N days (0 = never). */
  document_reminder_days: 3,
  /** Stop reminding about a document after this many reminders. */
  document_reminder_max: 3,
  meeting_durations: [30, 60],
  meeting_buffer_minutes: 10,
  meeting_min_notice_hours: 12,
  meeting_horizon_days: 21,
  meeting_office_address: "",
  accessibility_contact: { name: "", phone: "", email: "", response_days: 0 },
  quote_followup_client_days: 3,
  quote_followup_staff_days: 5,
};

/** Idempotent: inserts base configuration on an empty database, and demo data when enabled. */
export async function ensureSeed(db: Database) {
  const existing = await db.select({ n: sql<number>`count(*)::int` }).from(s.users);
  if ((existing[0]?.n ?? 0) > 0) {
    await ensureAdmin(db);
    return;
  }
  await seedBase(db);
  if (env.seedDemoData) await seedDemo(db);
}

/**
 * When ADMIN_EMAIL is set explicitly, make sure that account exists as an administrator.
 * Lets operators add their own admin to an existing (e.g. demo-seeded) database by setting one variable.
 */
async function ensureAdmin(db: Database) {
  if (!process.env.ADMIN_EMAIL) return;
  await db
    .insert(s.users)
    .values({ email: env.adminEmail, name: env.adminEmail.split("@")[0]!, role: "admin", status: "invited", locale: "he" })
    .onConflictDoNothing();
}

export async function seedBase(db: Database) {
  await db
    .insert(s.settings)
    .values(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })))
    .onConflictDoNothing();

  await db
    .insert(s.users)
    .values({ email: env.adminEmail, name: "מנהל מערכת", role: "admin", status: "active", locale: "he" })
    .onConflictDoNothing();

  await db
    .insert(s.priceListItems)
    .values([
      { code: "CONSULT-INIT", name: "פגישת ייעוץ ראשונית (60 דקות)", category: "other", unitPriceCents: 65000 },
      { code: "PLAN-RELOC", name: "תכנון תהליך מעבר והגירה", category: "relocation", unitPriceCents: 250000 },
      { code: "VISA-APP", name: "הכנת תיק בקשת ויזה", category: "immigration_visa", unitPriceCents: 320000 },
      { code: "CITIZEN-ELIG", name: "בדיקת זכאות לאזרחות זרה", category: "citizenship", unitPriceCents: 120000 },
      { code: "CITIZEN-FILE", name: "הכנת תיק בקשת אזרחות", category: "citizenship", unitPriceCents: 650000 },
      { code: "ARCHIVE-SEARCH", name: "איתור מסמכים בארכיונים", category: "citizenship", unitPriceCents: 90000 },
      { code: "BIZ-CONSULT", name: "ייעוץ עסקי ראשוני", category: "business_setup", unitPriceCents: 180000 },
      { code: "BIZ-SETUP", name: "ליווי הקמת עסק / חברה", category: "business_setup", unitPriceCents: 450000 },
      { code: "DOC-TRANSLATE", name: "תרגום נוטריוני (לעמוד)", category: "documents_translation", unitPriceCents: 12000 },
      { code: "DOC-APOSTILLE", name: "אימות אפוסטיל למסמך", category: "documents_translation", unitPriceCents: 35000 },
      { code: "HOURLY", name: "שעת עבודה מקצועית", category: "other", unitPriceCents: 45000 },
    ])
    .onConflictDoNothing();

  await db.insert(s.serviceTemplates).values([
    {
      name: "ייעוץ עסקי ראשוני",
      category: "business_setup",
      description: "איסוף נתונים, פגישת אבחון והמלצות",
      tasks: [
        { title: "איסוף נתונים מהלקוח", dueInDays: 2, requiresClientAction: true },
        { title: "פגישת אבחון", dueInDays: 5 },
        { title: "הכנת המלצות", dueInDays: 9 },
        { title: "שליחת סיכום ללקוח", dueInDays: 10 },
      ],
      documents: [
        { title: "תעודת התאגדות או תעודת עוסק", required: true },
        { title: "דוחות כספיים אחרונים", required: false, note: "אם יש" },
      ],
    },
    {
      name: "הכנת בקשת ויזה",
      category: "immigration_visa",
      description: "תהליך עבודה סטנדרטי לבקשת ויזה",
      tasks: [
        { title: "בדיקת המסמכים שהתקבלו", dueInDays: 2 },
        { title: "בקשת השלמות מהלקוח", dueInDays: 3, requiresClientAction: true },
        { title: "מילוי טפסי הבקשה", dueInDays: 7 },
        { title: "בדיקה פנימית", dueInDays: 9, priority: "high" },
        { title: "העברת התיק ללקוח", dueInDays: 10 },
      ],
      documents: [
        { title: "צילום דרכון בתוקף", required: true, note: "עמוד התמונה, באיכות טובה" },
        { title: "תמונת פספורט", required: true },
        { title: "אישור העסקה או הזמנה מהמעסיק", required: true },
        { title: "קורות חיים", required: false },
      ],
    },
    {
      name: "בדיקת זכאות לאזרחות",
      category: "citizenship",
      description: "בדיקת זכאות ותכנון הגשה",
      tasks: [
        { title: "איסוף פרטי שושלת משפחתית", dueInDays: 3, requiresClientAction: true },
        { title: "בדיקת זכאות מול הקריטריונים", dueInDays: 7 },
        { title: "הכנת חוות דעת ללקוח", dueInDays: 10 },
      ],
      documents: [
        { title: "צילום דרכון או תעודת זהות", required: true },
        { title: "תעודת לידה", required: true },
        { title: "תעודת לידה של ההורה או הסב/סבתא שדרכם הזכאות", required: true },
        { title: "תעודות נישואין או שינוי שם במשפחה", required: false, note: "אם רלוונטי" },
      ],
    },
    {
      name: "ייעוץ ראשוני ותכנון תהליך",
      category: "relocation",
      description: "פגישת היכרות, מיפוי אפשרויות ותוכנית פעולה",
      tasks: [
        { title: "פגישת היכרות", dueInDays: 3 },
        { title: "מיפוי מסלולים אפשריים", dueInDays: 8 },
        { title: "שליחת תוכנית פעולה", dueInDays: 12 },
      ],
    },
  ]);
}

const europeSummary: IntakeSummary = {
  request_title: "בדיקת אפשרויות מעבר לאירופה עם המשפחה",
  request_description:
    "משפחה בת ארבע נפשות מעוניינת לבחון מעבר לאחת ממדינות אירופה. מדינת היעד טרם נבחרה, ותאריך היעד המשוער הוא בעוד כשנה.",
  service_category: "relocation",
  customer_goal: "קבלת הכוונה לגבי מסלולי מעבר ואפשרויות שירות.",
  known_facts: [
    { label: "מספר נפשות", value: "4 (זוג ושני ילדים)" },
    { label: "מדינת יעד", value: "טרם נבחרה" },
    { label: "תאריך יעד", value: "בעוד כשנה" },
  ],
  constraints: ["מעבר בתוך כשנה"],
  missing_information: ["מדינת יעד מועדפת", "מצב אזרחות נוכחי", "מקור פרנסה מתוכנן"],
  suggested_next_questions: ["האם יש לאחד מבני המשפחה אזרחות נוספת?"],
  urgency: "normal",
  needs_human_review: true,
  assumptions: ["סוג השירות המוצע הוא ייעוץ ראשוני ותכנון תהליך"],
};

export async function seedDemo(db: Database) {
  const year = new Date().getFullYear();
  const insertedUsers = await db
    .insert(s.users)
    .values([
      { email: "manager@example.com", name: "דנה לוי", role: "case_manager", phone: "050-0000001" },
      { email: "staff@example.com", name: "יואב כהן", role: "staff" },
      { email: "finance@example.com", name: "מיכל אברהם", role: "finance" },
      {
        email: "client@example.com",
        name: "נועם ישראלי",
        role: "customer",
        phone: "052-0000002",
        termsAcceptedAt: hoursAgo(400),
        aiConsentAt: hoursAgo(400),
      },
      {
        email: "biz@example.com",
        name: "רוני גולן",
        role: "customer",
        termsAcceptedAt: hoursAgo(300),
        aiConsentAt: hoursAgo(300),
      },
    ])
    .returning();
  const byEmail = Object.fromEntries(insertedUsers.map((u) => [u.email, u]));
  const manager = byEmail["manager@example.com"]!;
  const staff = byEmail["staff@example.com"]!;
  const noam = byEmail["client@example.com"]!;
  const roni = byEmail["biz@example.com"]!;

  const [org] = await db.insert(s.organizations).values({ name: "גולן טכנולוגיות בע\"מ", businessId: "515000000" }).returning();
  const [noamCustomer] = await db.insert(s.customers).values({ userId: noam.id, type: "private" }).returning();
  const [roniCustomer] = await db
    .insert(s.customers)
    .values({ userId: roni.id, type: "company", organizationId: org!.id })
    .returning();

  const num = (n: number) => `CASE-${year}-${String(n).padStart(4, "0")}`;

  // 1) New request, unassigned — appears in the inbox.
  const [c1] = await db
    .insert(s.cases)
    .values({
      number: num(1),
      customerId: noamCustomer!.id,
      title: europeSummary.request_title,
      description: europeSummary.request_description,
      goal: europeSummary.customer_goal,
      serviceCategory: "relocation",
      status: "submitted",
      urgency: "normal",
      intakeSummary: europeSummary,
      lastClientActivityAt: hoursAgo(3),
      createdAt: hoursAgo(3),
      updatedAt: hoursAgo(3),
    })
    .returning();
  await db.insert(s.caseEvents).values({
    caseId: c1!.id,
    type: "case_submitted",
    actorId: noam.id,
    actorKind: "customer",
    visibility: "client",
    createdAt: hoursAgo(3),
  });

  // 2) Active case waiting for a document from the customer.
  const citizenshipSummary: IntakeSummary = {
    request_title: "בדיקת אפשרויות לאזרחות אירופית",
    request_description: "הלקוח מעוניין לבדוק זכאות לאזרחות פורטוגלית מכוח סבא שנולד בליסבון.",
    service_category: "citizenship",
    customer_goal: "קבלת אזרחות אירופית",
    known_facts: [
      { label: "מדינה", value: "פורטוגל" },
      { label: "קשר משפחתי", value: "סבא מצד אב" },
    ],
    constraints: [],
    missing_information: ["תעודת לידה של הסבא"],
    suggested_next_questions: [],
    urgency: "normal",
    needs_human_review: true,
    assumptions: [],
  };
  const [c2] = await db
    .insert(s.cases)
    .values({
      number: num(2),
      customerId: noamCustomer!.id,
      title: citizenshipSummary.request_title,
      description: citizenshipSummary.request_description,
      goal: citizenshipSummary.customer_goal,
      serviceCategory: "citizenship",
      status: "awaiting_client",
      urgency: "normal",
      assigneeId: manager.id,
      intakeSummary: citizenshipSummary,
      reviewedAt: hoursAgo(330),
      lastStaffActivityAt: hoursAgo(20),
      lastClientActivityAt: hoursAgo(200),
      createdAt: hoursAgo(340),
      updatedAt: hoursAgo(20),
    })
    .returning();
  const [q2] = await db
    .insert(s.quotes)
    .values({
      caseId: c2!.id,
      status: "approved",
      serviceName: "בדיקת זכאות והכנת תיק אזרחות פורטוגלית",
      scope: "בדיקת זכאות, איתור מסמכים והכנת תיק בקשה מלא.",
      included: "בדיקת זכאות\nאיתור מסמכים בארכיונים\nהכנת תיק הבקשה",
      excluded: "אגרות ממשלתיות\nתרגומים נוטריוניים",
      currency: "ILS",
      taxRate: "18",
      subtotalCents: 770000,
      taxCents: 138600,
      totalCents: 908600,
      paymentTerms: "תשלום מלא עם אישור ההצעה",
      timeline: "כ-8 שבועות מקבלת כל המסמכים",
      terms: "ההצעה אינה כוללת התחייבות לתוצאת ההליך מול הרשויות.",
      validUntil: daysFromNowIso(-300),
      sentAt: hoursAgo(300),
      sentById: manager.id,
      approvedAt: hoursAgo(260),
      approvedById: noam.id,
      createdById: manager.id,
      createdAt: hoursAgo(310),
    })
    .returning();
  await db.insert(s.quoteItems).values([
    { quoteId: q2!.id, description: "בדיקת זכאות לאזרחות זרה", quantity: "1", unitPriceCents: 120000, sortOrder: 0 },
    { quoteId: q2!.id, description: "הכנת תיק בקשת אזרחות", quantity: "1", unitPriceCents: 650000, sortOrder: 1 },
  ]);
  await db.insert(s.payments).values({
    quoteId: q2!.id,
    caseId: c2!.id,
    provider: "mock",
    providerSessionId: "mock_seed_1",
    providerPaymentId: "mock_pay_seed_1",
    amountCents: 908600,
    currency: "ILS",
    status: "succeeded",
    paidAt: hoursAgo(250),
    createdById: noam.id,
    createdAt: hoursAgo(251),
  });
  const [docReq] = await db
    .insert(s.documents)
    .values({
      caseId: c2!.id,
      title: "תעודת לידה של הסבא",
      status: "requested",
      requestNote: "נא להעלות צילום ברור של תעודת הלידה המקורית, כולל שני הצדדים.",
      requestedById: manager.id,
      createdById: manager.id,
      createdAt: hoursAgo(20),
    })
    .returning();
  await db.insert(s.tasks).values([
    { caseId: c2!.id, title: "בדיקת זכאות מול הקריטריונים", status: "done", assigneeId: manager.id, completedAt: hoursAgo(100), sortOrder: 0, createdById: manager.id },
    { caseId: c2!.id, title: "קבלת תעודת לידה של הסבא", status: "waiting", assigneeId: manager.id, requiresClientAction: true, dueDate: daysFromNowIso(3), relatedDocumentId: docReq!.id, sortOrder: 1, createdById: manager.id },
    { caseId: c2!.id, title: "איתור רישום בארכיון ליסבון", status: "in_progress", assigneeId: staff.id, dueDate: daysFromNowIso(-1), priority: "high", sortOrder: 2, createdById: manager.id },
    { caseId: c2!.id, title: "הכנת תיק הבקשה", status: "todo", assigneeId: manager.id, dueDate: daysFromNowIso(14), sortOrder: 3, createdById: manager.id },
  ]);
  await db.insert(s.messages).values([
    { caseId: c2!.id, senderId: manager.id, kind: "thread", body: "שלום נועם, קיבלנו את התשלום ואנחנו מתחילים בטיפול. נעדכן אותך בכל שלב.", createdAt: hoursAgo(248) },
    { caseId: c2!.id, senderId: noam.id, kind: "thread", body: "תודה רבה! אשמח לדעת מה נדרש ממני.", createdAt: hoursAgo(200) },
    { caseId: c2!.id, senderId: manager.id, kind: "thread", isInfoRequest: true, body: "כדי להמשיך נצטרך את תעודת הלידה של הסבא. העלינו בקשה בלשונית המסמכים.", createdAt: hoursAgo(20) },
    { caseId: c2!.id, senderId: staff.id, kind: "internal_note", body: "פניתי לארכיון בליסבון, ממתין לתשובה.", createdAt: hoursAgo(30) },
  ]);
  const ev2: (typeof s.caseEvents.$inferInsert)[] = [
    { caseId: c2!.id, type: "case_submitted", actorId: noam.id, actorKind: "customer", visibility: "client", createdAt: hoursAgo(340) },
    { caseId: c2!.id, type: "assigned", actorId: manager.id, actorKind: "staff", visibility: "internal", data: { assignee: manager.name }, createdAt: hoursAgo(335) },
    { caseId: c2!.id, type: "status_changed", actorId: manager.id, actorKind: "staff", visibility: "client", data: { from: "submitted", to: "under_review" }, createdAt: hoursAgo(330) },
    { caseId: c2!.id, type: "quote_sent", actorId: manager.id, actorKind: "staff", visibility: "client", data: { version: 1 }, createdAt: hoursAgo(300) },
    { caseId: c2!.id, type: "quote_approved", actorId: noam.id, actorKind: "customer", visibility: "client", data: { version: 1 }, createdAt: hoursAgo(260) },
    { caseId: c2!.id, type: "payment_succeeded", actorKind: "system", visibility: "client", data: { amount: 908600, currency: "ILS" }, createdAt: hoursAgo(250) },
    { caseId: c2!.id, type: "status_changed", actorKind: "system", visibility: "client", data: { from: "awaiting_payment", to: "active" }, createdAt: hoursAgo(250) },
    { caseId: c2!.id, type: "task_completed", actorId: manager.id, actorKind: "staff", visibility: "internal", data: { title: "בדיקת זכאות מול הקריטריונים" }, createdAt: hoursAgo(100) },
    { caseId: c2!.id, type: "client_update", actorId: manager.id, actorKind: "staff", visibility: "client", data: { text: "בדיקת הזכאות הראשונית הושלמה — נראה שקיימת זכאות עקרונית." }, createdAt: hoursAgo(99) },
    { caseId: c2!.id, type: "document_requested", actorId: manager.id, actorKind: "staff", visibility: "client", data: { title: "תעודת לידה של הסבא" }, createdAt: hoursAgo(20) },
    { caseId: c2!.id, type: "status_changed", actorId: manager.id, actorKind: "staff", visibility: "client", data: { from: "active", to: "awaiting_client" }, createdAt: hoursAgo(20) },
  ];
  await db.insert(s.caseEvents).values(ev2);

  // 3) Business request with a quote waiting for approval.
  const [c3] = await db
    .insert(s.cases)
    .values({
      number: num(3),
      customerId: roniCustomer!.id,
      title: "ייעוץ להקמת חברה בת בגרמניה",
      description: "חברת הייטק ישראלית מעוניינת להקים חברה בת בברלין לצורך גיוס עובדים מקומיים.",
      goal: "הקמת ישות משפטית בגרמניה בתוך 4 חודשים",
      serviceCategory: "business_setup",
      status: "quote_sent",
      urgency: "high",
      assigneeId: manager.id,
      reviewedAt: hoursAgo(70),
      lastStaffActivityAt: hoursAgo(26),
      lastClientActivityAt: hoursAgo(72),
      createdAt: hoursAgo(72),
      updatedAt: hoursAgo(26),
    })
    .returning();
  const [q3] = await db
    .insert(s.quotes)
    .values({
      caseId: c3!.id,
      status: "sent",
      serviceName: "ליווי הקמת חברה בת בגרמניה",
      scope: "ייעוץ מקדים, בחירת מבנה משפטי, ליווי רישום החברה ופתיחת חשבון בנק.",
      included: "פגישת אבחון\nהמלצה על מבנה משפטי\nליווי הרישום",
      excluded: "אגרות רישום בגרמניה\nשכר טרחת נוטריון מקומי",
      currency: "ILS",
      taxRate: "18",
      subtotalCents: 630000,
      taxCents: 113400,
      totalCents: 743400,
      paymentTerms: "תשלום מלא עם אישור ההצעה",
      timeline: "כ-12 שבועות",
      terms: "לוחות הזמנים תלויים בגורמים חיצוניים ובזמינות המסמכים.",
      validUntil: daysFromNowIso(12),
      sentAt: hoursAgo(26),
      sentById: manager.id,
      createdById: manager.id,
      createdAt: hoursAgo(30),
    })
    .returning();
  await db.insert(s.quoteItems).values([
    { quoteId: q3!.id, description: "ייעוץ עסקי ראשוני", quantity: "1", unitPriceCents: 180000, sortOrder: 0 },
    { quoteId: q3!.id, description: "ליווי הקמת עסק / חברה", quantity: "1", unitPriceCents: 450000, sortOrder: 1 },
  ]);
  await db.insert(s.caseEvents).values([
    { caseId: c3!.id, type: "case_submitted", actorId: roni.id, actorKind: "customer", visibility: "client", createdAt: hoursAgo(72) },
    { caseId: c3!.id, type: "status_changed", actorId: manager.id, actorKind: "staff", visibility: "client", data: { from: "submitted", to: "under_review" }, createdAt: hoursAgo(70) },
    { caseId: c3!.id, type: "quote_sent", actorId: manager.id, actorKind: "staff", visibility: "client", data: { version: 1 }, createdAt: hoursAgo(26) },
  ]);

  // 4) Completed case.
  const [c4] = await db
    .insert(s.cases)
    .values({
      number: num(4),
      customerId: roniCustomer!.id,
      title: "תרגום ואימות מסמכי התאגדות",
      description: "תרגום תעודת התאגדות ותקנון לאנגלית עם אפוסטיל.",
      goal: "מסמכים מתורגמים ומאומתים",
      serviceCategory: "documents_translation",
      status: "completed",
      urgency: "normal",
      assigneeId: staff.id,
      completedAt: hoursAgo(500),
      createdAt: hoursAgo(800),
      updatedAt: hoursAgo(500),
    })
    .returning();
  await db.insert(s.caseEvents).values([
    { caseId: c4!.id, type: "case_submitted", actorId: roni.id, actorKind: "customer", visibility: "client", createdAt: hoursAgo(800) },
    { caseId: c4!.id, type: "status_changed", actorId: staff.id, actorKind: "staff", visibility: "client", data: { from: "active", to: "completed" }, createdAt: hoursAgo(500) },
  ]);

  await db.insert(s.caseCounters).values({ year, value: 4 }).onConflictDoUpdate({ target: s.caseCounters.year, set: { value: 4 } });
}

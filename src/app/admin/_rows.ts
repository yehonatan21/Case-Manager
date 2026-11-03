import type { listStaffCases } from "@/lib/services/cases";
import type { CaseRow } from "@/components/admin/cases-table";

export function toCaseRows(rows: Awaited<ReturnType<typeof listStaffCases>>): CaseRow[] {
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    status: r.status,
    urgency: r.urgency,
    serviceCategory: r.serviceCategory,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    assigneeName: r.assigneeName,
    customerName: r.customerName,
    missingCount: (r.aiSummary?.missing_information ?? r.intakeSummary?.missing_information ?? []).length,
    hasAiSummary: !!r.aiSummary,
  }));
}

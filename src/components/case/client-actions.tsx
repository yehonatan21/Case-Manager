"use client";

import { CreditCard, FileUp, FileText, MessageSquareReply, ListChecks, Clock } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import type { ClientAction } from "@/lib/services/cases";

/** Maps a computed action to its localized label, explanation, CTA and target tab. */
export function useActionText() {
  const { d } = useI18n();
  return (a: ClientAction) => {
    switch (a.type) {
      case "approve_quote":
        return { icon: FileText, title: d.caseView.actionApproveQuote, text: fmt(d.caseView.actionApproveQuoteText, { service: a.service }), cta: d.caseView.goToQuote, tab: "quote" };
      case "quote_expired":
        return { icon: Clock, title: d.caseView.actionExpired, text: d.caseView.actionExpiredText, cta: d.caseView.goToQuote, tab: "quote" };
      case "pay":
        return { icon: CreditCard, title: d.caseView.actionPay, text: d.caseView.actionPayText, cta: d.caseView.goToPay, tab: "quote" };
      case "upload":
        return { icon: FileUp, title: d.caseView.actionUpload, text: fmt(d.caseView.actionUploadText, { title: a.title }), cta: d.caseView.goToUpload, tab: "documents" };
      case "reply":
        return { icon: MessageSquareReply, title: d.caseView.actionReply, text: d.caseView.actionReplyText, cta: d.caseView.goToMessages, tab: "messages" };
      case "task":
        return { icon: ListChecks, title: fmt(d.caseView.actionTask, { title: a.title }), text: "", cta: d.caseView.goToMessages, tab: "messages" };
    }
  };
}

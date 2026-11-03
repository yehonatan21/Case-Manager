/** Data minimisation: strip direct identifiers before content is sent to an external model. */
export function redactPII(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/(?:\+?\d[\d\s-]{7,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "[phone/id]" : m))
    .replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, "[card]");
}

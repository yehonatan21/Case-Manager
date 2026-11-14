/**
 * Text for PDFs in Hebrew and English. pdf-lib draws glyphs left to right and has no bidi support, so text is
 * reordered to visual order here (Unicode Bidirectional Algorithm via bidi-js, with bracket mirroring), and each
 * run is drawn with the font that has its glyphs (Rubik's Hebrew and Latin subsets are separate files).
 */
import fs from "node:fs";
import path from "node:path";
import bidiFactory from "bidi-js";
import fontkit from "@pdf-lib/fontkit";
import { rgb, type PDFDocument, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

const bidi = bidiFactory();
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const fontCache = new Map<string, Buffer>();
const fontFile = (name: string) => {
  if (!fontCache.has(name)) fontCache.set(name, fs.readFileSync(path.join(FONT_DIR, name)));
  return fontCache.get(name)!;
};

export type Fonts = { regular: FontPair; bold: FontPair };
type FontPair = { hebrew: PDFFont; latin: PDFFont };

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const load = (f: string) => doc.embedFont(fontFile(f), { subset: true });
  const [hr, lr, hb, lb] = await Promise.all([
    load("rubik-hebrew-400-normal.woff"),
    load("rubik-latin-400-normal.woff"),
    load("rubik-hebrew-700-normal.woff"),
    load("rubik-latin-700-normal.woff"),
  ]);
  return { regular: { hebrew: hr, latin: lr }, bold: { hebrew: hb, latin: lb } };
}

const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<", "«": "»", "»": "«" };
const isHebrew = (ch: string) => /[֐-׿יִ-ﭏ₪]/.test(ch);

/** Reorders one line of text into visual (left-to-right drawing) order. */
export function visualOrder(text: string, base: "rtl" | "ltr"): string {
  if (!text) return text;
  const levels = bidi.getEmbeddingLevels(text, base);
  // bidi-js works on UTF-16 indices; keep one array slot per code unit so indices line up.
  const chars = text.split("");
  for (let i = 0; i < chars.length; i++) if (levels.levels[i]! & 1 && MIRROR[chars[i]!]) chars[i] = MIRROR[chars[i]!]!;
  for (const [start, end] of bidi.getReorderSegments(text, levels)) {
    const seg = chars.slice(start, end + 1).reverse();
    // Reversing split a surrogate pair (emoji etc.) into low+high: put each pair back in order.
    for (let k = 0; k < seg.length - 1; k++) {
      const a = seg[k]!.charCodeAt(0);
      if (a >= 0xdc00 && a <= 0xdfff) {
        [seg[k], seg[k + 1]] = [seg[k + 1]!, seg[k]!];
        k++;
      }
    }
    chars.splice(start, end - start + 1, ...seg);
  }
  return chars.join("");
}

const hasGlyph = (font: PDFFont, cp: number) => {
  const f = (font as unknown as { embedder?: { font?: { hasGlyphForCodePoint?: (c: number) => boolean } } }).embedder?.font;
  return f?.hasGlyphForCodePoint ? f.hasGlyphForCodePoint(cp) : true;
};

/** Splits visual-order text into runs drawable with one font each; characters neither font has are dropped. */
function runs(visual: string, pair: FontPair): { text: string; font: PDFFont }[] {
  const out: { text: string; font: PDFFont }[] = [];
  for (const ch of Array.from(visual)) {
    const cp = ch.codePointAt(0)!;
    const preferred = isHebrew(ch) ? pair.hebrew : pair.latin;
    const other = preferred === pair.hebrew ? pair.latin : pair.hebrew;
    const font = hasGlyph(preferred, cp) ? preferred : hasGlyph(other, cp) ? other : null;
    if (!font) continue;
    const last = out[out.length - 1];
    if (last && last.font === font) last.text += ch;
    else out.push({ text: ch, font });
  }
  // fontkit's layout reverses runs of right-to-left script on its own, so hand it Hebrew runs in logical order
  // (they're already in visual order here); its reversal then puts them back where they belong.
  for (const r of out) if (r.font === pair.hebrew && /[\u0590-\u05FF\uFB1D-\uFB4F]/.test(r.text)) r.text = Array.from(r.text).reverse().join("");
  return out;
}

export type TextStyle = { size: number; bold?: boolean; color?: RGB };

export class Writer {
  constructor(
    readonly fonts: Fonts,
    readonly dir: "rtl" | "ltr",
  ) {}

  private pair(s: TextStyle) {
    return s.bold ? this.fonts.bold : this.fonts.regular;
  }

  width(text: string, s: TextStyle): number {
    return runs(visualOrder(text, this.dir), this.pair(s)).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, s.size), 0);
  }

  /** Draws one line. `x` is the start edge: the right edge for RTL, the left edge for LTR. */
  line(page: PDFPage, text: string, x: number, y: number, s: TextStyle, align: "start" | "end" | "center" = "start", boxWidth = 0) {
    const w = this.width(text, s);
    let left: number;
    if (align === "center") left = x - w / 2;
    else if (this.dir === "rtl") left = align === "start" ? x - w : x - boxWidth;
    else left = align === "start" ? x : x + boxWidth - w;
    for (const r of runs(visualOrder(text, this.dir), this.pair(s))) {
      page.drawText(r.text, { x: left, y, size: s.size, font: r.font, color: s.color ?? rgb(0.1, 0.12, 0.16) });
      left += r.font.widthOfTextAtSize(r.text, s.size);
    }
    return w;
  }

  /** Breaks text into lines no wider than `maxWidth` (on spaces; very long words are cut). Keeps paragraph breaks. */
  wrap(text: string, maxWidth: number, s: TextStyle): string[] {
    const out: string[] = [];
    for (const para of text.replace(/\r/g, "").split("\n")) {
      const words = para.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        out.push("");
        continue;
      }
      let cur = "";
      for (let word of words) {
        while (this.width(word, s) > maxWidth && word.length > 1) {
          let cut = word.length - 1;
          while (cut > 1 && this.width(word.slice(0, cut), s) > maxWidth) cut--;
          if (cur) out.push(cur);
          out.push(word.slice(0, cut));
          cur = "";
          word = word.slice(cut);
        }
        const next = cur ? `${cur} ${word}` : word;
        if (this.width(next, s) <= maxWidth) cur = next;
        else {
          if (cur) out.push(cur);
          cur = word;
        }
      }
      if (cur) out.push(cur);
    }
    return out;
  }
}

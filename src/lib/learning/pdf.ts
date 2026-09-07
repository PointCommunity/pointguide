import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SessionDetail } from "./store";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = 58;

function printable(value: string): string {
  return value
    .replace(/[\u2010-\u2015]/gu, "-")
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[\u201c\u201d]/gu, '"')
    .replace(/\u2026/gu, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/gu, "?")
    .replace(/\s+/gu, " ")
    .trim();
}

function linesFor(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = printable(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= width) {
      line = word;
      continue;
    }
    let fragment = "";
    for (const character of word) {
      if (font.widthOfTextAtSize(fragment + character, size) > width && fragment) {
        lines.push(fragment);
        fragment = character;
      } else fragment += character;
    }
    line = fragment;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function buildSessionPdf(detail: SessionDetail): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(printable(detail.conversation.title));
  document.setAuthor("PointGuide");
  document.setSubject("Evidence-grounded PointGuide support session");
  document.setCreator("PointGuide");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.13, 0.12);
  const muted = rgb(0.32, 0.39, 0.37);
  const mint = rgb(0.12, 0.48, 0.39);
  let page: PDFPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function addPage(): void {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  function ensure(height: number): void {
    if (y - height < BOTTOM) addPage();
  }

  function rule(): void {
    ensure(18);
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.7, color: rgb(0.78, 0.82, 0.8) });
    y -= 18;
  }

  function text(value: string, options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}): void {
    const size = options.size ?? 10;
    const selectedFont = options.font ?? regular;
    const indent = options.indent ?? 0;
    const lineHeight = size * 1.38;
    const lines = linesFor(value, selectedFont, size, CONTENT_WIDTH - indent);
    ensure(lines.length * lineHeight + (options.gap ?? 7));
    for (const line of lines) {
      page.drawText(line, { x: MARGIN + indent, y, size, font: selectedFont, color: options.color ?? ink });
      y -= lineHeight;
    }
    y -= options.gap ?? 7;
  }

  text("POINTGUIDE SUPPORT SESSION", { size: 8, font: bold, color: mint, gap: 9 });
  text(detail.conversation.title, { size: 22, font: bold, gap: 10 });
  text(`Updated ${new Date(detail.conversation.updatedAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "America/Chicago" })} | ${detail.conversation.userTurnCount} of 6 questions used`, { size: 9, color: muted, gap: 14 });
  rule();

  const chronologicalTurns = [...detail.turns].reverse();
  for (const [index, turn] of chronologicalTurns.entries()) {
    const estimatedHeight = 78
      + linesFor(turn.question, bold, 14, CONTENT_WIDTH).length * 20
      + linesFor(turn.answer.directAnswer, regular, 11, CONTENT_WIDTH).length * 16
      + turn.answer.safetyAndAssumptions.reduce((height, note) => height + linesFor(note, regular, 9, CONTENT_WIDTH - 8).length * 13, 26)
      + turn.answer.steps.reduce((height, step) => height + linesFor(step, regular, 9, CONTENT_WIDTH - 8).length * 13, 26)
      + turn.answer.claims.reduce((height, claim) => height + linesFor(claim.text, regular, 9, CONTENT_WIDTH - 8).length * 13, 26)
      + turn.answer.evidence.reduce((height, source) => height + 34 + linesFor(source.excerpt, regular, 8, CONTENT_WIDTH - 8).length * 11, 28);
    ensure(Math.min(estimatedHeight, PAGE_HEIGHT - MARGIN - BOTTOM));
    text(`POINT QUESTION ${index + 1}`, { size: 8, font: bold, color: mint, gap: 5 });
    text(turn.question, { size: 14, font: bold, gap: 10 });
    text(`PointGuide answer | ${turn.answer.confidence.toLocaleLowerCase("en-US")} | ${turn.answer.reviewStatus === "PASSED" ? "reviewed" : "standard review"}`, { size: 8, font: bold, color: muted, gap: 6 });
    text(turn.answer.directAnswer, { size: 11, gap: 10 });
    if (turn.answer.safetyAndAssumptions.length) {
      text("Before you change anything", { size: 10, font: bold, color: rgb(0.55, 0.36, 0.05), gap: 4 });
      for (const note of turn.answer.safetyAndAssumptions) text(`- ${note}`, { size: 9, color: muted, indent: 8, gap: 4 });
      y -= 3;
    }
    if (turn.answer.steps.length) {
      text("Next checks", { size: 10, font: bold, gap: 4 });
      for (const [stepIndex, step] of turn.answer.steps.entries()) text(`${stepIndex + 1}. ${step}`, { size: 9, color: muted, indent: 8, gap: 4 });
      y -= 3;
    }
    if (turn.answer.claims.length) {
      text("Claim check", { size: 10, font: bold, gap: 4 });
      for (const claim of turn.answer.claims) text(`${claim.status}: ${claim.text}`, { size: 9, color: muted, indent: 8, gap: 4 });
      y -= 3;
    }
    text(`Evidence (${turn.answer.evidence.length})`, { size: 10, font: bold, gap: 4 });
    if (!turn.answer.evidence.length) text("No current source establishes this answer.", { size: 9, color: muted, indent: 8 });
    for (const source of turn.answer.evidence) {
      ensure(34 + linesFor(source.excerpt, regular, 8, CONTENT_WIDTH - 8).length * 11);
      text(source.title, { size: 9, font: bold, indent: 8, gap: 2 });
      text(`${source.authority} | ${source.locator ?? source.path ?? source.url ?? "Source record"}`, { size: 8, color: muted, indent: 8, gap: 2 });
      text(source.excerpt, { size: 8, color: muted, indent: 8, gap: 6 });
    }
    if (index < chronologicalTurns.length - 1) rule();
  }

  const pages = document.getPages();
  for (const [index, currentPage] of pages.entries()) {
    currentPage.drawText(`PointGuide | Page ${index + 1} of ${pages.length}`, { x: MARGIN, y: 30, size: 8, font: regular, color: muted });
  }
  return document.save();
}

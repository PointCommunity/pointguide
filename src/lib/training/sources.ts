import { createHash, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { createRequire } from "node:module";
import { BlockList, isIP } from "node:net";
import { basename, extname } from "node:path";
import sharp from "sharp";
import type { EvidenceItem } from "@/lib/agent/schema";
import { terms } from "@/lib/evidence/search";
import { extractHtmlText } from "@/lib/sources/content";
import { trainingSourceAccept, type AcceptedTrainingSource, type TrainingSourceContent, type TrainingSourceInput } from "./types";

const require = createRequire(import.meta.url);
const WordExtractor = require("word-extractor") as new () => { extract(input: Buffer): Promise<{ getBody(): string; getFootnotes(): string; getEndnotes(): string; getHeaders(): string; getTextboxes(): string }> };
const allowedExtensions = new Set(trainingSourceAccept.split(","));
const maxItems = 10;
const maxFileBytes = 15 * 1024 * 1024;
const maxTotalBytes = 30 * 1024 * 1024;
const maxExtractedCharacters = 1_000_000;
const imageTypes = new Set(["jpeg", "png", "webp", "svg"]);
const mediaTypes = new Map([
  [".md", "text/markdown"], [".markdown", "text/markdown"], [".txt", "text/plain"], [".rtf", "application/rtf"],
  [".pdf", "application/pdf"], [".doc", "application/msword"], [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".html", "text/html"], [".htm", "text/html"], [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"], [".png", "image/png"], [".webp", "image/webp"], [".svg", "image/svg+xml"],
]);

const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const cleanText = (value: string) => value.replace(/\r\n?/gu, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "").replace(/[ \t]+\n/gu, "\n").replace(/\n{4,}/gu, "\n\n\n").trim();
const decode = (bytes: Uint8Array) => { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return new TextDecoder("windows-1252").decode(bytes); } };
const displayName = (value: string, fallback: string) => value.replace(/[\u0000-\u001F\u007F]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 240) || fallback;

export class TrainingSourceError extends Error {}

export function assertTrainingSourceCapacity(existing: TrainingSourceContent[], inputs: TrainingSourceInput[]) {
  if (existing.length + inputs.length > maxItems) throw new TrainingSourceError(`A Training session can contain no more than ${maxItems} source items.`);
  const bytes = existing.reduce((sum, source) => sum + (source.originalSize ?? 0), 0) + inputs.reduce((sum, source) => sum + (source.originalBytes?.byteLength ?? 0), 0);
  if (bytes > maxTotalBytes) throw new TrainingSourceError("A Training session can contain no more than 30 MiB of uploaded source files.");
}

export function assertPreparedTrainingSourceCapacity(sources: TrainingSourceContent[], prepared: TrainingSourceContent) {
  assertTrainingSourceCapacity(sources.filter(source => source.id !== prepared.id), [{ kind: prepared.kind, originalName: prepared.originalName, mediaType: prepared.mediaType, sourceUrl: prepared.sourceUrl ?? undefined, originalBytes: prepared.originalBytes ?? undefined }]);
}

export async function parseTrainingSourceForm(form: FormData): Promise<TrainingSourceInput[]> {
  const urls = String(form.get("urls") ?? "").split(/\r?\n/u).map(value => value.trim()).filter(Boolean);
  const files = form.getAll("sources").filter((value): value is File => value instanceof File && value.size > 0);
  if (urls.length + files.length > maxItems) throw new TrainingSourceError(`Add no more than ${maxItems} source items at once.`);
  const inputs: TrainingSourceInput[] = urls.map(value => {
    let url: URL;
    if (value.length > 2_048) throw new TrainingSourceError("Website URL exceeds the 2,048-character limit.");
    try { url = new URL(value); } catch { throw new TrainingSourceError(`Enter a complete website URL: ${value}`); }
    if (!/^https?:$/u.test(url.protocol) || url.username || url.password) throw new TrainingSourceError(`Only public HTTP or HTTPS website URLs are supported: ${value}`);
    return { kind: "URL", originalName: displayName(basename(url.pathname), url.hostname), mediaType: "text/html", sourceUrl: url.href };
  });
  let total = 0;
  for (const file of files) {
    const extension = extname(file.name).toLocaleLowerCase();
    if (!allowedExtensions.has(extension)) throw new TrainingSourceError(`Choose a supported source file. ${file.name} is not supported.`);
    if (file.size > maxFileBytes) throw new TrainingSourceError(`${file.name} exceeds the 15 MiB source limit.`);
    total += file.size;
    if (total > maxTotalBytes) throw new TrainingSourceError("Source files exceed the 30 MiB total limit.");
    inputs.push({ kind: "FILE", originalName: displayName(file.name, `source${extension}`), mediaType: mediaTypes.get(extension)!, originalBytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return inputs;
}

type Address = { address: string; family: number };
type WebResponse = { status: number; location: string | null; mediaType: string; bytes: Buffer };
interface WebDependencies { resolve(hostname: string): Promise<Address[]>; request(url: URL, address: Address): Promise<WebResponse> }

const blockedIpv4 = new BlockList(), blockedIpv6 = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blockedIpv4.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20], ["5f00::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) blockedIpv6.addSubnet(network, prefix, "ipv6");
const publicAddress = (value: string): boolean => { const family = isIP(value); return family === 4 ? !blockedIpv4.check(value, "ipv4") : family === 6 && !blockedIpv6.check(value, "ipv6"); };

async function defaultResolve(hostname: string): Promise<Address[]> { return dnsLookup(hostname, { all: true, verbatim: true }); }

export function pinnedLookup(selected: Address): NonNullable<RequestOptions["lookup"]> {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [selected]);
    else callback(null, selected.address, selected.family);
  };
}

async function defaultRequest(url: URL, selected: Address): Promise<WebResponse> {
  return new Promise((resolve, reject) => {
    const options: RequestOptions = {
      protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: `${url.pathname}${url.search}`,
      method: "GET", headers: { accept: "text/html,application/xhtml+xml,text/plain;q=0.8", "accept-encoding": "identity", "user-agent": "PointGuide/1.0" },
      lookup: pinnedLookup(selected),
    };
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(options, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maxFileBytes) request.destroy(new TrainingSourceError("Website source exceeds the 15 MiB limit.")); else chunks.push(chunk); });
      response.once("end", () => resolve({ status: response.statusCode ?? 0, location: response.headers.location ?? null, mediaType: String(response.headers["content-type"] ?? ""), bytes: Buffer.concat(chunks) }));
    });
    request.setTimeout(20_000, () => request.destroy(new TrainingSourceError("Website source timed out.")));
    request.once("error", reject); request.end();
  });
}

export async function captureTrainingWebPage(value: string, dependencies: Partial<WebDependencies> = {}) {
  const resolve = dependencies.resolve ?? defaultResolve; const request = dependencies.request ?? defaultRequest;
  let current = new URL(value); const requestedUrl = current.href;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    if (!/^https?:$/u.test(current.protocol) || current.username || current.password || (current.port && current.port !== "80" && current.port !== "443")) throw new TrainingSourceError("Trainer sources must use a public website URL on a standard port.");
    current.hash = "";
    const addresses = await resolve(current.hostname);
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new TrainingSourceError("Trainer source URL must resolve only to a public website.");
    const response = await request(current, addresses[0]);
    if (response.status >= 300 && response.status < 400 && response.location) { current = new URL(response.location, current); continue; }
    if (response.status < 200 || response.status >= 300) throw new TrainingSourceError(`Website source returned HTTP ${response.status}.`);
    const mediaType = response.mediaType.split(";", 1)[0].trim().toLocaleLowerCase();
    if (!new Set(["text/html", "application/xhtml+xml", "text/plain"]).has(mediaType)) throw new TrainingSourceError("Website URL must return an HTML or text page. Upload other material as a file.");
    return { requestedUrl, finalUrl: current.href, mediaType, bytes: response.bytes };
  }
  throw new TrainingSourceError("Website source redirected too many times.");
}

function rtfText(raw: string): string {
  return raw
    .replace(/\{\\\*(?:[^{}]|\{[^{}]*\})*\}/gu, "")
    .replace(/\\u(-?\d+)\??/gu, (_match, value) => String.fromCodePoint(Number(value) < 0 ? Number(value) + 65_536 : Number(value)))
    .replace(/\\'([a-f0-9]{2})/giu, (_match, value) => String.fromCharCode(Number.parseInt(value, 16)))
    .replace(/\\(?:par|line)\b/gu, "\n")
    .replace(/\\tab\b/gu, "\t")
    .replace(/\\[a-z]+-?\d* ?/giu, "")
    .replace(/\\([{}\\])/gu, "$1")
    .replace(/[{}]/gu, "");
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false });
  const document = await task.promise;
  try {
    if (document.numPages > 500) throw new TrainingSourceError("PDF exceeds the 500-page source limit.");
    const pages: string[] = [];
    for (let page = 1; page <= document.numPages; page += 1) {
      const content = await (await document.getPage(page)).getTextContent();
      pages.push(`PDF page ${page}\n${content.items.flatMap(item => "str" in item ? [item.str] : []).join(" ")}`);
    }
    return pages.join("\n\n");
  } finally { await task.destroy(); }
}

function assertDocxArchive(bytes: Uint8Array) {
  const archive = Buffer.from(bytes); let end = -1;
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); offset -= 1) if (archive.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  if (end < 0 || archive.readUInt16LE(end + 4) || archive.readUInt16LE(end + 6) || archive.readUInt16LE(end + 8) !== archive.readUInt16LE(end + 10)) throw new TrainingSourceError("Word document is not a supported DOCX archive.");
  const entries = archive.readUInt16LE(end + 10), directorySize = archive.readUInt32LE(end + 12), directoryOffset = archive.readUInt32LE(end + 16);
  if (entries > 1_000 || directoryOffset + directorySize > end) throw new TrainingSourceError("Word document archive exceeds safe extraction limits.");
  let offset = directoryOffset; let expanded = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > end || archive.readUInt32LE(offset) !== 0x02014b50 || archive.readUInt16LE(offset + 8) & 1) throw new TrainingSourceError("Word document is not a supported DOCX archive.");
    const compressed = archive.readUInt32LE(offset + 20), uncompressed = archive.readUInt32LE(offset + 24);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff || (expanded += uncompressed) > maxTotalBytes) throw new TrainingSourceError("Word document archive exceeds the 30 MiB expanded-content limit.");
    offset += 46 + archive.readUInt16LE(offset + 28) + archive.readUInt16LE(offset + 30) + archive.readUInt16LE(offset + 32);
  }
  if (offset !== directoryOffset + directorySize) throw new TrainingSourceError("Word document is not a supported DOCX archive.");
}

async function wordText(bytes: Uint8Array, extension: string): Promise<string> {
  const input = Buffer.from(bytes);
  if (extension === ".docx") { if (input.length < 4 || input.readUInt32LE(0) !== 0x04034b50) throw new TrainingSourceError("DOCX signature does not match its filename."); assertDocxArchive(input); }
  else if (input.length < 8 || !input.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) throw new TrainingSourceError("DOC signature does not match its filename.");
  const document = await new WordExtractor().extract(Buffer.from(bytes));
  return [document.getBody(), document.getHeaders(), document.getFootnotes(), document.getEndnotes(), document.getTextboxes()].filter(Boolean).join("\n\n");
}

export async function prepareTrainingSource(source: TrainingSourceContent, dependencies: { describeImage(bytes: Uint8Array, mediaType: string): Promise<string>; captureWebPage?: typeof captureTrainingWebPage }): Promise<TrainingSourceContent> {
  let bytes = source.originalBytes; let mediaType = source.mediaType; let finalUrl = source.finalUrl;
  if (source.kind === "URL") {
    const captured = await (dependencies.captureWebPage ?? captureTrainingWebPage)(source.sourceUrl!);
    bytes = captured.bytes; mediaType = captured.mediaType; finalUrl = captured.finalUrl;
  }
  if (!bytes?.length) throw new TrainingSourceError("Trainer source has no content.");
  const extension = extname(source.originalName).toLocaleLowerCase(); let text: string;
  if (source.kind === "URL" || extension === ".html" || extension === ".htm") text = mediaType === "text/plain" ? decode(bytes) : extractHtmlText(decode(bytes));
  else if (extension === ".md" || extension === ".markdown" || extension === ".txt") text = decode(bytes);
  else if (extension === ".rtf") text = rtfText(decode(bytes));
  else if (extension === ".pdf") { if (!Buffer.from(bytes).subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new TrainingSourceError("PDF signature does not match its filename."); text = await pdfText(bytes); }
  else if (extension === ".doc" || extension === ".docx") text = await wordText(bytes, extension);
  else {
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.format || !imageTypes.has(metadata.format)) throw new TrainingSourceError("Image content does not match a supported JPEG, PNG, WebP, or SVG file.");
    const modelBytes = metadata.format === "svg" ? await sharp(bytes, { limitInputPixels: 40_000_000 }).png().toBuffer() : bytes;
    const modelType = metadata.format === "svg" ? "image/png" : `image/${metadata.format}`;
    const description = await dependencies.describeImage(modelBytes, modelType);
    text = metadata.format === "svg" ? `${extractHtmlText(decode(bytes))}\n\n${description}` : description;
    mediaType = `image/${metadata.format === "svg" ? "svg+xml" : metadata.format}`;
  }
  text = cleanText(text);
  if (!text) throw new TrainingSourceError("No usable text or visual information could be extracted from this source.");
  if (text.length > maxExtractedCharacters) throw new TrainingSourceError("Extracted source exceeds the 1,000,000-character limit.");
  const now = new Date().toISOString();
  return { ...source, mediaType, finalUrl, originalBytes: bytes, originalSize: bytes.length, originalDigest: digest(bytes), extractedText: text, extractedDigest: digest(text), status: "READY", error: null, capturedAt: now, updatedAt: now };
}

function extensionFor(source: TrainingSourceContent): string {
  if (source.kind === "URL") return source.mediaType === "text/plain" ? ".txt" : ".html";
  const extension = extname(source.originalName).toLocaleLowerCase();
  return allowedExtensions.has(extension) ? (extension === ".jpeg" ? ".jpg" : extension === ".markdown" ? ".md" : extension) : ".bin";
}

export function trainingSourceEvidence(query: string, sources: TrainingSourceContent[]): EvidenceItem[] {
  const queryTerms = terms(query); const selected: Array<{ source: TrainingSourceContent; ordinal: number; text: string; score: number }> = [];
  for (const source of sources.filter(item => item.status === "READY" && item.extractedText)) {
    const chunks = Array.from({ length: Math.ceil(source.extractedText!.length / 3_000) }, (_, ordinal) => {
      const text = source.extractedText!.slice(ordinal * 3_000, ordinal * 3_000 + 3_500).trim();
      const normalized = text.toLocaleLowerCase();
      return { source, ordinal, text, score: queryTerms.reduce((score, term) => score + normalized.split(term).length - 1, 0) };
    }).filter(item => item.text);
    chunks.sort((left, right) => right.score - left.score || left.ordinal - right.ordinal);
    if (chunks[0]) selected.push(chunks[0]);
    selected.push(...chunks.slice(1, 3).filter(item => item.score > 0));
  }
  return selected.sort((left, right) => right.score - left.score || left.source.id.localeCompare(right.source.id) || left.ordinal - right.ordinal).slice(0, 12).map(({ source, ordinal, text }) => ({
    id: `trainer-source:${source.id}:${ordinal}`, kind: "TRAINER_SOURCE", sourceId: source.id, title: source.originalName,
    path: `research/pointguide-training/${source.sessionId}/sources/${source.id}.md`, url: source.finalUrl ?? source.sourceUrl ?? undefined,
    locator: `${source.kind === "URL" ? source.finalUrl ?? source.sourceUrl : source.originalName}; extracted segment ${ordinal + 1}`,
    authority: "Trainer-provided reliable source for this Training session; official source use begins only after answer acceptance and publication.",
    capturedAt: source.capturedAt!, excerpt: text, digest: digest(text),
  }));
}

export function trainingSourcePublicationFiles(sessionId: string, sources: TrainingSourceContent[]): Record<string, string | Uint8Array> {
  const files: Record<string, string | Uint8Array> = {};
  for (const source of [...sources].sort((left, right) => left.id.localeCompare(right.id))) {
    if (source.sessionId !== sessionId || source.status !== "READY" || !source.originalBytes || !source.originalDigest || !source.extractedText || !source.extractedDigest || !source.capturedAt) throw new TrainingSourceError("Every trainer source must be ready before acceptance.");
    const root = `research/pointguide-training/${sessionId}`;
    files[`${root}/originals/${source.id}${extensionFor(source)}`] = source.originalBytes;
    files[`${root}/sources/${source.id}.md`] = `# ${source.originalName}\n\nSource kind: ${source.kind}\n\nOriginal URL: ${source.sourceUrl ?? "Not applicable"}\n\nFinal URL: ${source.finalUrl ?? "Not applicable"}\n\nMedia type: ${source.mediaType}\n\nCaptured at: ${source.capturedAt}\n\nOriginal SHA-256: ${source.originalDigest}\n\nExtracted SHA-256: ${source.extractedDigest}\n\n## Extracted content\n\n${source.extractedText}\n`;
  }
  return files;
}

export function acceptedTrainingSources(sessionId: string, sources: TrainingSourceContent[]): AcceptedTrainingSource[] {
  const files = trainingSourcePublicationFiles(sessionId, sources);
  return [...sources].sort((left, right) => left.id.localeCompare(right.id)).map(source => {
    const originalPath = Object.keys(files).find(path => path.includes(`/originals/${source.id}.`))!;
    const extractedPath = `research/pointguide-training/${sessionId}/sources/${source.id}.md`;
    return { id: source.id, kind: source.kind, originalName: source.originalName, mediaType: source.mediaType, sourceUrl: source.sourceUrl, finalUrl: source.finalUrl, capturedAt: source.capturedAt!, originalPath, originalDigest: source.originalDigest!, extractedPath, extractedDigest: digest(files[extractedPath]) };
  });
}

export function newTrainingSource(input: TrainingSourceInput, sessionId: string, now = new Date()): TrainingSourceContent {
  const bytes = input.originalBytes ? Buffer.from(input.originalBytes) : null;
  return { id: randomUUID(), sessionId, kind: input.kind, originalName: input.originalName, mediaType: input.mediaType, sourceUrl: input.sourceUrl ?? null, finalUrl: null, originalSize: bytes?.length ?? null, originalDigest: bytes ? digest(bytes) : null, originalBytes: bytes, extractedText: null, extractedDigest: null, status: "PENDING", error: null, capturedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

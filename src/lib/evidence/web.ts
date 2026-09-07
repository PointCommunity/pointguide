import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { EvidenceItem } from "@/lib/agent/schema";

const MAX_BYTES = 512 * 1024;
type Resolver = (hostname: string) => Promise<string[]>;

function privateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
  }
  const normalized = address.toLocaleLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}

async function defaultResolve(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

export async function fetchSupplementalEvidence(urlValue: string, options: {
  fetcher?: typeof fetch;
  resolve?: Resolver;
  now?: Date;
} = {}): Promise<EvidenceItem> {
  const url = new URL(urlValue);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Supplemental evidence requires a credential-free HTTPS URL.");
  if (isIP(url.hostname) && privateAddress(url.hostname)) throw new Error("Private network URLs are prohibited.");
  const addresses = await (options.resolve ?? defaultResolve)(url.hostname);
  if (!addresses.length || addresses.some(privateAddress)) throw new Error("The URL resolves to a private or unavailable address.");

  const response = await (options.fetcher ?? fetch)(url.href, { method:"GET", redirect:"manual", signal:AbortSignal.timeout(10_000), headers:{ Accept:"text/html, text/plain, application/json" } });
  if (response.status >= 300 && response.status < 400) throw new Error("Supplemental evidence redirects are not accepted.");
  if (!response.ok) throw new Error(`Supplemental evidence returned status ${response.status}.`);
  const type = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim();
  if (!["text/html", "text/plain", "application/json"].includes(type)) throw new Error("Unsupported supplemental evidence content type.");
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("Supplemental evidence exceeded the size limit.");
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Supplemental evidence exceeded the size limit.");
  const digest = createHash("sha256").update(text).digest("hex");
  return {
    id:`web:${digest}`,
    kind:"PRIMARY_WEB",
    title:url.hostname,
    url:url.href,
    authority:"supplemental-web",
    capturedAt:(options.now ?? new Date()).toISOString(),
    excerpt:text.replace(/\s+/gu, " ").trim().slice(0, 2_000),
    digest,
  };
}

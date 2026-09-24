import type { EvidenceItem } from "@/lib/agent/schema";

export function repositoryEvidenceUrl(item: EvidenceItem): string | null {
  const provenance = /^(PointCommunity\/[A-Za-z0-9._-]+)@([a-f0-9]{40})(?:;|$)/u.exec(item.locator ?? "");
  if (!provenance || !item.path || item.path.startsWith("/") || item.path.split("/").some(part => !part || part === "." || part === "..")) return null;
  return `https://github.com/${provenance[1]}/blob/${provenance[2]}/${item.path.split("/").map(encodeURIComponent).join("/")}`;
}

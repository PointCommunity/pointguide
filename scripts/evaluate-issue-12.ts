import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { indexContents } from "../src/lib/sources/content";
import { searchCorpus } from "../src/lib/evidence/search";

const inquiries = [
  { question: "How many local microphone sockets does our M32R have, and are 32 channels physical inputs?", expected: "M32R" },
  { question: "How do I record a sermon in REAPER and verify the saved recording?", expected: "REAPER" },
  { question: "How do Planning Center Services schedule responses work for our church?", expected: "Planning Center" },
];

for (const [repository, root] of [
  ["PointCommunity/pointaudio", "/Users/chris/Documents/ChatGPT/PointAudio"],
  ["PointCommunity/pointplanning", "/Users/chris/Documents/ChatGPT/PointPlanning"],
] as const) {
  const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const paths = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" }).trim().split("\n");
  const selected = paths.filter(path => /^(?:data|docs|research|skills)\/.*\.(?:md|html|txt|json|ya?ml|csv)$/iu.test(path) && !/(?:^|\/)README\.md$/u.test(path) && !path.startsWith("research/pointguide-training/"));
  const files = new Map(await Promise.all(selected.map(async path => [path, await readFile(join(root, path), "utf8")] as const)));
  const chunks = indexContents(repository, commit, new Date().toISOString(), files, selected.filter(path => !/(?:^|\/)(?:source-inventory\.json|checksums\.sha256)$/u.test(path)));
  for (const inquiry of inquiries) {
    const start = performance.now();
    const results = searchCorpus(inquiry.question, chunks);
    process.stdout.write(JSON.stringify({ repository, commit, question: inquiry.question, expected: inquiry.expected, chunks: chunks.length, elapsedMs: Math.round(performance.now() - start), top: results.map(item => ({ id: item.id, path: item.path, locator: item.locator, authority: item.authority })) }) + "\n");
  }
}

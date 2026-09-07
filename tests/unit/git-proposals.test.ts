import { describe, expect, it } from "vitest";
import { ChangeProposal, allowedRepositoryPath, contentDigest } from "@/lib/git/proposals";

describe("governed repository proposals", () => {
  it.each(["data/equipment/m32.json", "docs/m32-sync.html", "research/aes50/source.json", "skills/audio/SKILL.md"])("allows governed path %s", (path) => expect(allowedRepositoryPath(path)).toBe(true));
  it.each(["../AGENTS.md", "/etc/passwd", "src/app.ts", "docs/../../secret", ".github/workflows/pwn.yml"])("rejects unsafe path %s", (path) => expect(allowedRepositoryPath(path)).toBe(false));
  it("uses typed transitions and exact content digests", () => {
    const proposal = new ChangeProposal({ id:"p1", targetRepository:"PointCommunity/pointaudio", targetPath:"docs/fix.html", operation:"UPDATE", proposedContent:"<html>fixed</html>" });
    expect(proposal.digest).toBe(contentDigest("<html>fixed</html>"));
    proposal.transition("IN_REVIEW"); proposal.transition("APPROVED"); proposal.transition("QUEUED"); proposal.transition("PR_OPENED");
    expect(proposal.state).toBe("PR_OPENED");
    expect(() => proposal.transition("APPROVED")).toThrow("transition");
  });
});

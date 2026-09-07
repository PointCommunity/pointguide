import { createHash } from "node:crypto";

export const proposalStates = ["DRAFT","IN_REVIEW","APPROVED","QUEUED","PR_OPENED","REJECTED","FAILED"] as const;
export type ProposalState = typeof proposalStates[number];
const transitions: Record<ProposalState, readonly ProposalState[]> = {
  DRAFT:["IN_REVIEW"], IN_REVIEW:["APPROVED","REJECTED"], APPROVED:["QUEUED"], QUEUED:["PR_OPENED","FAILED"],
  PR_OPENED:[], REJECTED:[], FAILED:["QUEUED"],
};
export function transitionAllowed(from: ProposalState, to: ProposalState): boolean { return transitions[from].includes(to); }

export function allowedRepositoryPath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) return false;
  return /^(data|docs|research|skills)\/[A-Za-z0-9._/-]+$/u.test(path);
}
export function contentDigest(content: string): string { return createHash("sha256").update(content).digest("hex"); }

export class ChangeProposal {
  readonly id:string; readonly targetRepository:string; readonly targetPath:string; readonly operation:"CREATE"|"UPDATE"|"SUPERSEDE"; readonly proposedContent:string; readonly digest:string;
  state:ProposalState="DRAFT";
  constructor(input:{id:string;targetRepository:string;targetPath:string;operation:"CREATE"|"UPDATE"|"SUPERSEDE";proposedContent:string}) {
    if (!allowedRepositoryPath(input.targetPath)) throw new Error("Target path is outside the governed allow-list.");
    if (input.targetRepository !== "PointCommunity/pointaudio") throw new Error("Target repository is not configured.");
    Object.assign(this,input); this.id=input.id; this.targetRepository=input.targetRepository; this.targetPath=input.targetPath; this.operation=input.operation; this.proposedContent=input.proposedContent; this.digest=contentDigest(input.proposedContent);
  }
  transition(next:ProposalState):void { if (!transitionAllowed(this.state, next)) throw new Error(`Invalid proposal transition: ${this.state} -> ${next}`); this.state=next; }
}

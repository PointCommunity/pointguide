import { getDatabase } from "@/db/client";
import { parseEnvironment } from "@/lib/config/env";
import { MemoryProposalRepository, PostgresProposalRepository, type ProposalRepository } from "./store";
let memory: ProposalRepository | null = null;
export function getRuntimeProposalRepository(): ProposalRepository {
  const environment = parseEnvironment(process.env);
  if (environment.AUTH_MODE === "fixture") return memory ??= new MemoryProposalRepository();
  if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  return new PostgresProposalRepository(getDatabase(environment.DATABASE_URL));
}

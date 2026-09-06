import { demoSourceCount } from "@/lib/evidence/demo";

export function GET(): Response {
  return Response.json({ status: "ready", mode: "fixture", sources: demoSourceCount });
}

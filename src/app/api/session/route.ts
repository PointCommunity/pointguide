import { handleSession } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleSession(request, getRuntimeSessionDependencies());
}

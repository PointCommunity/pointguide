import { handleAccountList } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleAccountList(request, getRuntimeSessionDependencies());
}

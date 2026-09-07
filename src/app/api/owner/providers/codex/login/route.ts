import { handleCodexLogin } from "@/lib/providers/http";
import { getRuntimeProviderDependencies } from "@/lib/providers/runtime";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleCodexLogin(request, getRuntimeProviderDependencies());
}

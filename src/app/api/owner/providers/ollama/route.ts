import { handleOllamaConnect } from "@/lib/providers/http";
import { getRuntimeProviderDependencies } from "@/lib/providers/runtime";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return handleOllamaConnect(request, getRuntimeProviderDependencies());
}

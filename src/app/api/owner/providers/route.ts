import { handleProviderList } from "@/lib/providers/http";
import { getRuntimeProviderDependencies } from "@/lib/providers/runtime";

export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleProviderList(request, getRuntimeProviderDependencies());
}

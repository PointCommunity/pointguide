import { handleReviewSetting } from "@/lib/providers/http";
import { getRuntimeProviderDependencies } from "@/lib/providers/runtime";

export const runtime = "nodejs";

export function PUT(request: Request): Promise<Response> {
  return handleReviewSetting(request, getRuntimeProviderDependencies());
}

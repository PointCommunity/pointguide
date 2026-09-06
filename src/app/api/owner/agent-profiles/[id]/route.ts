import { handleProfilePut } from "@/lib/providers/http";
import { getRuntimeProviderDependencies } from "@/lib/providers/runtime";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleProfilePut(request, (await context.params).id, getRuntimeProviderDependencies());
}

import { handleAccountUpdate } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return handleAccountUpdate(request, id, getRuntimeSessionDependencies());
}

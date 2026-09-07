import { handleDisplayNameUpdate } from "@/lib/auth/http";
import { getRuntimeSessionDependencies } from "@/lib/auth/runtime";

export async function PATCH(request: Request): Promise<Response> {
  return handleDisplayNameUpdate(request, getRuntimeSessionDependencies());
}

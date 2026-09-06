import { handleProviderModels } from "@/lib/providers/http";
import { getRuntimeProviderDependencies } from "@/lib/providers/runtime";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }): Promise<Response> {
  return handleProviderModels(request, (await context.params).provider, false, getRuntimeProviderDependencies());
}

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }): Promise<Response> {
  return handleProviderModels(request, (await context.params).provider, true, getRuntimeProviderDependencies());
}

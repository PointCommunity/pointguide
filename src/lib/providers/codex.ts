import { z } from "zod";
import { normalizeCodexCatalog, parseCodexCatalogPage } from "@/lib/providers/catalog";
import type { AppServerClient, DeviceLogin, ProviderModel } from "@/lib/providers/types";

const loginSchema = z.object({
  type: z.literal("chatgptDeviceCode"),
  loginId: z.string().trim().min(1),
  verificationUrl: z.url().refine((url) => new URL(url).protocol === "https:", "Verification URL must use HTTPS."),
  userCode: z.string().trim().min(1).max(100),
});

export class CodexProvider {
  constructor(private readonly client: AppServerClient) {}

  async startDeviceLogin(): Promise<DeviceLogin> {
    const result = loginSchema.parse(await this.client.request("account/login/start", { type: "chatgptDeviceCode" }));
    return {
      loginId: result.loginId,
      verificationUrl: result.verificationUrl,
      userCode: result.userCode,
    };
  }

  async listModels(): Promise<ProviderModel[]> {
    const allModels: unknown[] = [];
    let cursor: string | null = null;
    const seenCursors = new Set<string>();

    for (let page = 0; page < 50; page += 1) {
      const params: Record<string, unknown> = { limit: 20, includeHidden: false };
      if (cursor) params.cursor = cursor;
      const parsed = parseCodexCatalogPage(await this.client.request("model/list", params));
      allModels.push(...parsed.data);
      if (!parsed.nextCursor) return normalizeCodexCatalog({ data: allModels, nextCursor: null });
      if (seenCursors.has(parsed.nextCursor)) throw new Error("Codex model catalog returned a repeated cursor.");
      seenCursors.add(parsed.nextCursor);
      cursor = parsed.nextCursor;
    }
    throw new Error("Codex model catalog exceeded the page limit.");
  }
}

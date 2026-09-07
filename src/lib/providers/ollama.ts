import { normalizeOllamaCatalog } from "@/lib/providers/catalog";
import type { ProviderFetch, ProviderModel } from "@/lib/providers/types";

const CATALOG_URL = "https://ollama.com/api/tags";
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;

export class OllamaCloudProvider {
  private readonly fetcher: ProviderFetch;

  constructor(options: { fetcher?: ProviderFetch } = {}) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async connect(apiKey: string): Promise<ProviderModel[]> {
    const normalizedKey = apiKey.trim();
    if (normalizedKey.length < 16 || normalizedKey.length > 4_096) throw new Error("A valid Ollama API key is required.");

    const response = await this.fetcher(CATALOG_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${normalizedKey}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Ollama catalog request failed with status ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_CATALOG_BYTES) throw new Error("Ollama catalog response exceeded the size limit.");
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_CATALOG_BYTES) throw new Error("Ollama catalog response exceeded the size limit.");
    try {
      return normalizeOllamaCatalog(JSON.parse(body));
    } catch {
      throw new Error("Ollama returned an invalid model catalog.");
    }
  }
}

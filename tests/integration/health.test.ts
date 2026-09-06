import { describe, expect, it } from "vitest";
import { GET as health } from "@/app/api/healthz/route";
import { GET as readiness } from "@/app/api/readyz/route";

describe("operational probes", () => {
  it("reports process liveness without dependency or secret detail", async () => {
    const response = await health();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "alive", service: "pointguide" });
  });

  it("reports demo readiness and corpus source count", async () => {
    const response = await readiness();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready", mode: "fixture", sources: 20 });
  });
});

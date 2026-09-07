import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { AppServerClient } from "@/lib/providers/types";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

export class CodexAppServerProcessClient implements AppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private lastStderr = "";
  private readonly listeners = new Set<(method: string, params: unknown) => void>();

  subscribe(listener: (method: string, params: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request(method: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    await this.ensureReady();
    return this.rawRequest(method, params);
  }

  dispose(): void {
    this.process?.kill("SIGTERM");
    this.process = null;
    this.ready = null;
    this.rejectPending(new Error("Codex App Server stopped."));
  }

  private ensureReady(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.start().catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private async start(): Promise<void> {
    const child = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      env: process.env,
    });
    this.process = child;
    createInterface({ input: child.stdout }).on("line", (line) => this.receive(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.lastStderr = `${this.lastStderr}${chunk}`.slice(-2_000);
    });
    child.once("error", (error) => this.rejectPending(new Error(`Codex App Server could not start: ${error.message}`)));
    child.once("exit", (code) => {
      this.process = null;
      this.ready = null;
      this.rejectPending(new Error(`Codex App Server exited (${code ?? "signal"}).`));
    });

    await this.rawRequest("initialize", {
      clientInfo: { name: "pointguide", title: "PointGuide", version: "0.1.0" },
    });
    this.send({ method: "initialized", params: {} });
  }

  private rawRequest(method: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server request timed out: ${method}.`));
      }, 20_000);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.send({ method, id, params });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error("Codex App Server write failed."));
      }
    });
  }

  private send(message: unknown): void {
    if (!this.process?.stdin.writable) throw new Error("Codex App Server is unavailable.");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    if (!("id" in message) || typeof message.id !== "number") {
      if ("method" in message && typeof message.method === "string") {
        for (const listener of this.listeners) listener(message.method, "params" in message ? message.params : null);
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if ("error" in message) {
      const detail = message.error && typeof message.error === "object" && "message" in message.error && typeof message.error.message === "string"
        ? message.error.message.slice(0, 500)
        : "Codex App Server returned an error.";
      pending.reject(new Error(detail));
      return;
    }
    pending.resolve("result" in message ? message.result : null);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.lastStderr = "";
  }
}

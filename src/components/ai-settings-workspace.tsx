"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentProfileRecord,
  DeviceLogin,
  ProfileRole,
  ProviderId,
  ProviderModel,
  PublicProviderConnection,
  ReviewSetting,
} from "@/lib/providers/types";

interface SettingsPayload {
  providers: PublicProviderConnection[];
  profiles: AgentProfileRecord[];
  review: ReviewSetting;
}

const profileIds: Record<ProfileRole, string> = {
  PRIMARY: "00000000-0000-4000-8000-000000000001",
  REVIEWER: "00000000-0000-4000-8000-000000000002",
};

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T | { error?: { message?: string } };
  if (!response.ok) throw new Error("error" in (payload as object) ? (payload as { error?: { message?: string } }).error?.message : "Request failed.");
  return payload as T;
}

function statusLabel(status: PublicProviderConnection["status"]): string {
  return status.charAt(0) + status.slice(1).toLocaleLowerCase("en-US");
}

function ProfileEditor({ role, models, existing, onSaved }: {
  role: ProfileRole;
  models: Readonly<Record<ProviderId, ProviderModel[]>>;
  existing: AgentProfileRecord | undefined;
  onSaved(profile: AgentProfileRecord): void;
}) {
  const availableProviders = (Object.keys(models) as ProviderId[]).filter((provider) => models[provider].length > 0);
  const [provider, setProvider] = useState<ProviderId>(existing?.provider ?? availableProviders[0] ?? "CODEX");
  const availableModels = models[provider];
  const [modelId, setModelId] = useState(existing?.modelId ?? availableModels[0]?.id ?? "");
  const model = availableModels.find((candidate) => candidate.id === modelId) ?? availableModels[0];
  const [effort, setEffort] = useState(existing?.reasoningEffort ?? "");
  const selectedEffort = model?.reasoningEfforts.some((candidate) => candidate.effort === effort)
    ? effort
    : model?.reasoningEfforts.find((candidate) => candidate.isDefault)?.effort ?? model?.reasoningEfforts[0]?.effort ?? "";
  const [prompt, setPrompt] = useState("");
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save() {
    if (!model || !prompt.trim()) return;
    setState("saving");
    try {
      const saved = await responseJson<AgentProfileRecord>(await fetch(`/api/owner/agent-profiles/${profileIds[role]}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: role === "PRIMARY" ? "Primary guide" : "Evidence reviewer",
          role,
          provider,
          modelId: model.id,
          reasoningEffort: selectedEffort || null,
          enabled,
          ownerPrompt: prompt,
        }),
      }));
      setPrompt("");
      setState("saved");
      onSaved(saved);
    } catch {
      setState("error");
    }
  }

  return (
    <article className="profile-editor">
      <header><div><p className="eyebrow">{role === "PRIMARY" ? "Answer agent" : "Review agent"}</p><h3>{role === "PRIMARY" ? "Primary profile" : "Reviewer profile"}</h3></div>{existing ? <span>Revision {existing.promptRevision}</span> : null}</header>
      {availableProviders.length === 0 ? <p className="provider-empty">Connect and refresh a provider before configuring this profile.</p> : (
        <div className="settings-fields">
          <label>Provider
            <select value={provider} onChange={(event) => { const next = event.target.value as ProviderId; setProvider(next); setModelId(models[next][0]?.id ?? ""); setEffort(""); setState("idle"); }}>
              {availableProviders.map((value) => <option key={value} value={value}>{value === "CODEX" ? "Codex" : "Ollama Cloud"}</option>)}
            </select>
          </label>
          <label>Model
            <select value={model?.id ?? ""} onChange={(event) => { const next = availableModels.find((candidate) => candidate.id === event.target.value); setModelId(event.target.value); setEffort(next?.reasoningEfforts.find((candidate) => candidate.isDefault)?.effort ?? next?.reasoningEfforts[0]?.effort ?? ""); setState("idle"); }}>
              {availableModels.map((value) => <option key={value.id} value={value.id}>{value.displayName}</option>)}
            </select>
          </label>
          <label>Reasoning effort
            <select value={selectedEffort} onChange={(event) => { setEffort(event.target.value); setState("idle"); }}>
              {model?.reasoningEfforts.length ? model.reasoningEfforts.map((value) => <option key={value.effort} value={value.effort}>{value.effort}</option>) : <option value="">Provider default</option>}
            </select>
          </label>
          <label className="prompt-field">Owner direction
            <textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); setState("idle"); }} placeholder={existing ? "Enter new direction to create another immutable revision" : "Describe this agent’s role and boundaries"} maxLength={12000} />
          </label>
          <label className="switch-row"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>Use this {role.toLocaleLowerCase("en-US")} profile</span></label>
          <button type="button" onClick={() => void save()} disabled={!model || !prompt.trim() || state === "saving"}>{state === "saving" ? "Saving…" : "Save profile"}</button>
          {state === "saved" ? <p role="status" className="settings-success">Profile saved as a new prompt revision.</p> : null}
          {state === "error" ? <p role="alert" className="settings-error">Profile could not be saved. Check the selected model and effort.</p> : null}
        </div>
      )}
    </article>
  );
}

export function AiSettingsWorkspace() {
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [models, setModels] = useState<Record<ProviderId, ProviderModel[]>>({ CODEX: [], OLLAMA_CLOUD: [] });
  const [login, setLogin] = useState<DeviceLogin | null>(null);
  const [ollamaKey, setOllamaKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadModels = useCallback(async (provider: ProviderId) => {
    const catalog = await responseJson<ProviderModel[]>(await fetch(`/api/owner/providers/${provider}/models`, { cache: "no-store" }));
    setModels((current) => ({ ...current, [provider]: catalog }));
  }, []);

  const loadSettings = useCallback(async () => {
    const payload = await responseJson<SettingsPayload>(await fetch("/api/owner/providers", { cache: "no-store" }));
    setSettings(payload);
    await Promise.all(payload.providers.filter((provider) => provider.status === "CONNECTED").map((provider) => loadModels(provider.provider)));
  }, [loadModels]);

  useEffect(() => {
    let active = true;
    void fetch("/api/owner/providers", { cache: "no-store" })
      .then(responseJson<SettingsPayload>)
      .then(async (payload) => {
        if (!active) return;
        setSettings(payload);
        await Promise.all(payload.providers.filter((provider) => provider.status === "CONNECTED").map((provider) => loadModels(provider.provider)));
      })
      .catch(() => { if (active) setError("AI settings could not be loaded."); });
    return () => { active = false; };
  }, [loadModels]);

  async function startCodex() {
    setBusy("codex-login"); setError(null);
    try {
      setLogin(await responseJson<DeviceLogin>(await fetch("/api/owner/providers/codex/login", { method: "POST" })));
      await loadSettings();
    } catch { setError("Codex sign-in could not be started."); } finally { setBusy(null); }
  }

  async function connectOllama() {
    setBusy("ollama"); setError(null);
    try {
      const response = await fetch("/api/owner/providers/ollama", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: ollamaKey }),
      });
      if (!response.ok) throw new Error("Connection failed");
      setOllamaKey("");
      await loadSettings();
    } catch { setError("Ollama Cloud could not be connected. Verify the key and try again."); } finally { setBusy(null); }
  }

  async function refresh(provider: ProviderId) {
    setBusy(`refresh-${provider}`); setError(null);
    try {
      const catalog = await responseJson<ProviderModel[]>(await fetch(`/api/owner/providers/${provider}/models`, { method: "POST" }));
      setModels((current) => ({ ...current, [provider]: catalog }));
      await loadSettings();
    } catch { setError(`${provider === "CODEX" ? "Codex" : "Ollama Cloud"} models could not be refreshed.`); } finally { setBusy(null); }
  }

  async function toggleReview(enabled: boolean) {
    const previous = settings?.review;
    setSettings((current) => current ? { ...current, review: { ...current.review, enabled } } : current);
    setBusy("review"); setError(null);
    try {
      const review = await responseJson<ReviewSetting>(await fetch("/api/owner/settings/review", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }),
      }));
      setSettings((current) => current ? { ...current, review } : current);
    } catch {
      if (previous) setSettings((current) => current ? { ...current, review: previous } : current);
      setError("The Deep research setting could not be changed.");
    } finally { setBusy(null); }
  }

  const profilesByRole = useMemo(() => Object.fromEntries((settings?.profiles ?? []).map((profile) => [profile.role, profile])) as Partial<Record<ProfileRole, AgentProfileRecord>>, [settings]);
  function saveProfile(profile: AgentProfileRecord) {
    setSettings((current) => current ? { ...current, profiles: [...current.profiles.filter((candidate) => candidate.id !== profile.id), profile] } : current);
  }

  return (
    <>
      <section className="welcome-panel compact-welcome" aria-labelledby="ai-title">
        <p className="eyebrow">Owner controls</p><h1 id="ai-title">AI setup</h1>
        <p>Connect server-side providers, choose only their advertised models and efforts, and govern how PointGuide answers and reviews evidence.</p>
      </section>
      {error ? <section className="error-panel" role="alert"><strong>Setup needs attention.</strong><p>{error}</p></section> : null}
      {!settings ? <p className="loading-state" role="status">Loading protected provider settings…</p> : (
        <>
          <section className="provider-section" aria-labelledby="providers-title">
            <div className="section-heading"><div><p className="eyebrow">Connections</p><h2 id="providers-title">Model providers</h2></div><span>Owner only</span></div>
            <div className="provider-grid">
              <article className="provider-card">
                <header><div><h3>Codex</h3><p>Headless ChatGPT device sign-in</p></div><span className="connection-state">{statusLabel(settings.providers.find((item) => item.provider === "CODEX")?.status ?? "DISCONNECTED")}</span></header>
                <button type="button" onClick={() => void startCodex()} disabled={busy !== null}>Start Codex sign-in</button>
                {login ? <div className="device-code" role="status"><span>Enter this code</span><strong>{login.userCode}</strong><a href={login.verificationUrl} target="_blank" rel="noreferrer">Open secure sign-in</a></div> : null}
                <button className="secondary-button" type="button" onClick={() => void refresh("CODEX")} disabled={busy !== null}>Refresh Codex models</button>
                <ul className="model-list" aria-label="Codex models">{models.CODEX.map((model) => <li key={model.id}><strong>{model.displayName}</strong><span>{model.reasoningEfforts.map((effort) => effort.effort).join(" · ") || "Provider default effort"}</span></li>)}</ul>
              </article>
              <article className="provider-card">
                <header><div><h3>Ollama Cloud</h3><p>Write-only API key</p></div><span className="connection-state">{statusLabel(settings.providers.find((item) => item.provider === "OLLAMA_CLOUD")?.status ?? "DISCONNECTED")}</span></header>
                <label>Ollama API key<input type="password" value={ollamaKey} onChange={(event) => setOllamaKey(event.target.value)} autoComplete="off" placeholder="Paste once; never shown again" /></label>
                <button type="button" onClick={() => void connectOllama()} disabled={ollamaKey.trim().length < 16 || busy !== null}>Connect Ollama</button>
                <button className="secondary-button" type="button" onClick={() => void refresh("OLLAMA_CLOUD")} disabled={busy !== null || models.OLLAMA_CLOUD.length === 0}>Refresh Ollama models</button>
                <ul className="model-list" aria-label="Ollama Cloud models">{models.OLLAMA_CLOUD.map((model) => <li key={model.id}><strong>{model.displayName}</strong><span>Provider default effort</span></li>)}</ul>
              </article>
            </div>
          </section>
          <section className="profiles-section" aria-labelledby="profiles-title">
            <div className="section-heading"><div><p className="eyebrow">Agent direction</p><h2 id="profiles-title">Profiles and prompts</h2></div><span>Versioned</span></div>
            <div className="profile-grid">
              <ProfileEditor role="PRIMARY" models={models} existing={profilesByRole.PRIMARY} onSaved={saveProfile} />
              <ProfileEditor role="REVIEWER" models={models} existing={profilesByRole.REVIEWER} onSaved={saveProfile} />
            </div>
          </section>
          <section className="review-setting" aria-labelledby="review-title">
            <div><p className="eyebrow">Evidence review</p><h2 id="review-title">Deep research</h2><p>When enabled, users may request a second configured agent to review every evidence-linked claim. It stays off for each new question.</p></div>
            <label className="switch-row"><input aria-label="Enable Deep research" type="checkbox" checked={settings.review.enabled} disabled={busy !== null} onChange={(event) => void toggleReview(event.target.checked)} /><span>{settings.review.enabled ? "Deep research is available" : "Deep research is hidden"}</span></label>
          </section>
        </>
      )}
    </>
  );
}

import Link from "next/link";

export function AccessState({ state }: { state: "pending" | "suspended" }) {
  const pending = state === "pending";
  return (
    <main className="access-state" id="main-content">
      <div className="access-state-mark" aria-hidden="true">{pending ? "…" : "!"}</div>
      <p className="eyebrow">PointGuide access</p>
      <h1>{pending ? "Access request received" : "Account access suspended"}</h1>
      <p>
        {pending
          ? "Your Google identity is verified. PointGuide will remain locked until an Owner or Admin approves your account and assigns a role."
          : "PointGuide is locked for this account. Please contact a PointGuide Owner or Admin if you believe access should be restored."}
      </p>
      <div className="access-state-actions">
        <Link href="/">Check access again</Link>
        <a href="/cdn-cgi/access/logout">Use another account</a>
      </div>
      <small>No support content or account directory is exposed while access is unavailable.</small>
    </main>
  );
}

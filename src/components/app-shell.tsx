"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { allowedNavigationKeys, lifecycleDestination, type NavigationKey } from "@/lib/auth/navigation";
import type { AccountRole, AccountStatus } from "@/lib/auth/types";

type IconName = NavigationKey;
type ShellIconName = IconName | "more";

const navigation: ReadonlyArray<{ href: string; label: string; icon: IconName }> = [
  { href: "/", label: "Ask", icon: "ask" },
  { href: "/sessions", label: "Sessions", icon: "sessions" },
  { href: "/knowledge", label: "Knowledge", icon: "knowledge" },
  { href: "/training", label: "Training", icon: "training" },
  { href: "/admin/accounts", label: "Admin", icon: "admin" },
  { href: "/owner/agent", label: "Agent Setup", icon: "owner" },
];

interface SessionAccount {
  email: string;
  displayName: string | null;
  role: AccountRole;
  status: AccountStatus;
}

function NavIcon({ name }: { name: ShellIconName }) {
  const paths: Record<ShellIconName, ReactNode> = {
    ask: <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 12.5v-6Z" />,
    sessions: <path d="M7 5h12v12H7V5Zm-2 3H4v11h11v-1M10 9h6m-6 3h6" />,
    knowledge: <path d="M5 4.5h9a3 3 0 0 1 3 3V19h-9a3 3 0 0 1-3-3V4.5Zm3 3h6m-6 3h6" />,
    training: <path d="m4 8 8-4 8 4-8 4-8-4Zm3 3.5V16c2.8 2.3 7.2 2.3 10 0v-4.5" />,
    admin: <path d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 7a7 7 0 0 1 14 0M19 5v6m-3-3h6" />,
    owner: <path d="M5 9.5 8 12l4-7 4 7 3-2.5-1.5 8h-11L5 9.5Zm2 11h10" />,
    more: <><path d="M5 7h14" /><path d="M5 12h14" /><path d="M5 17h14" /></>,
  };
  return <svg aria-hidden="true" className={`nav-icon${name === "more" ? " nav-more-icon" : ""}`} viewBox="0 0 24 24">{paths[name]}</svg>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [account, setAccount] = useState<SessionAccount | null>(null);
  const [sessionFailed, setSessionFailed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/session", { headers: { accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as SessionAccount | { error?: { code?: string } };
        if (response.status === 202 && "status" in payload) {
          window.location.replace(lifecycleDestination(payload.status) ?? "/pending");
          return;
        }
        if (response.status === 403 && "error" in payload && payload.error?.code === "ACCOUNT_SUSPENDED") {
          window.location.replace("/suspended");
          return;
        }
        if (!response.ok || !("role" in payload) || payload.status !== "APPROVED") throw new Error("Session unavailable");
        if (active) setAccount(payload);
      })
      .catch(() => { if (active) setSessionFailed(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMoreOpen(false);
      window.requestAnimationFrame(() => moreButtonRef.current?.focus());
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [moreOpen]);

  if (sessionFailed) {
    return (
      <main className="access-state" id="main-content">
        <div className="access-state-mark" aria-hidden="true">!</div>
        <p className="eyebrow">PointGuide access</p>
        <h1>Unable to verify access</h1>
        <p>Your identity could not be verified. Refresh after Cloudflare Access sign-in, or contact an Owner if this continues.</p>
        <div className="access-state-actions"><Link href="/">Try again</Link></div>
      </main>
    );
  }

  if (!account) {
    return <main className="access-state" id="main-content" aria-busy="true"><p className="eyebrow">PointGuide access</p><h1>Checking your access…</h1></main>;
  }

  const allowed = new Set(allowedNavigationKeys(account.role));
  const visibleNavigation = navigation.filter((item) => allowed.has(item.icon));
  const hasMobileOverflow = visibleNavigation.length > 4;
  const mobileNavigation = hasMobileOverflow ? visibleNavigation.slice(0, 4) : visibleNavigation;
  const overflowNavigation = hasMobileOverflow ? visibleNavigation.slice(4) : [];
  const name = account.displayName || account.email;
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toLocaleUpperCase("en-US");
  const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className={`app-frame ${visibleNavigation.length > 1 ? "has-bottom-nav" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="work-area">
        <header className="mobile-header app-header">
          <Link className="brand compact" href="/" aria-label="PointGuide home">
            <span className="brand-mark" aria-hidden="true"><span>P</span><i /></span>
            <strong>PointGuide</strong>
          </Link>
          <Link className="avatar" href="/account" aria-label="Open account settings">{initials}</Link>
        </header>
        <main id="main-content">{children}</main>
      </div>
      {visibleNavigation.length > 1 ? <>
        {hasMobileOverflow && moreOpen ? <button className="nav-overflow-backdrop" type="button" aria-label="Close More menu" onClick={() => setMoreOpen(false)} /> : null}
        <nav className="bottom-nav" aria-label="Primary navigation">
          <div className="mobile-nav-row" style={{ gridTemplateColumns: `repeat(${mobileNavigation.length + (hasMobileOverflow ? 1 : 0)}, minmax(0, 1fr))` }}>
            {mobileNavigation.map((item) => (
              <Link key={item.href} className={isActive(item.href) ? "active" : undefined} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>
                <NavIcon name={item.icon} /><span>{item.label}</span>
              </Link>
            ))}
            {hasMobileOverflow ? <button ref={moreButtonRef} className={overflowNavigation.some((item) => isActive(item.href)) ? "active" : undefined} type="button" aria-expanded={moreOpen} aria-controls="mobile-more-navigation" onClick={() => setMoreOpen((current) => !current)}>
              <NavIcon name="more" /><span>More</span>
            </button> : null}
          </div>
          <div className="desktop-nav-row">
            {visibleNavigation.map((item) => (
              <Link key={item.href} className={isActive(item.href) ? "active" : undefined} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>
                <NavIcon name={item.icon} /><span>{item.label}</span>
              </Link>
            ))}
          </div>
          {hasMobileOverflow ? <div className="nav-overflow-panel" id="mobile-more-navigation" hidden={!moreOpen}>
            <strong>More</strong>
            {overflowNavigation.map((item) => (
              <Link key={item.href} className={isActive(item.href) ? "active" : undefined} href={item.href} aria-current={isActive(item.href) ? "page" : undefined} onClick={() => setMoreOpen(false)}>
                <NavIcon name={item.icon} /><span>{item.label}</span>
              </Link>
            ))}
          </div> : null}
        </nav>
      </> : null}
    </div>
  );
}

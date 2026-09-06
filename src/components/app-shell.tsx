import type { ReactNode } from "react";
import Link from "next/link";

type IconName = "ask" | "knowledge" | "saved" | "training" | "admin" | "owner";

const navigation: ReadonlyArray<{ href: string; label: string; icon: IconName; restricted?: string }> = [
  { href: "/", label: "Ask", icon: "ask" },
  { href: "/knowledge", label: "Knowledge", icon: "knowledge" },
  { href: "/saved", label: "Saved", icon: "saved" },
  { href: "/training", label: "Train", icon: "training", restricted: "Trainer" },
  { href: "/admin/accounts", label: "Admin", icon: "admin", restricted: "Admin" },
  { href: "/owner/ai", label: "AI setup", icon: "owner", restricted: "Owner" },
];

function NavIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    ask: <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 12.5v-6Z" />,
    knowledge: <path d="M5 4.5h9a3 3 0 0 1 3 3V19h-9a3 3 0 0 1-3-3V4.5Zm3 3h6m-6 3h6" />,
    saved: <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3.5L6 20V5a1 1 0 0 1 1-1Z" />,
    training: <path d="m4 8 8-4 8 4-8 4-8-4Zm3 3.5V16c2.8 2.3 7.2 2.3 10 0v-4.5" />,
    admin: <path d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 7a7 7 0 0 1 14 0M19 5v6m-3-3h6" />,
    owner: <path d="M5 9.5 8 12l4-7 4 7 3-2.5-1.5 8h-11L5 9.5Zm2 11h10" />,
  };
  return <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24">{paths[name]}</svg>;
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="side-rail">
        <Link className="brand" href="/" aria-label="PointGuide home">
          <span className="brand-mark" aria-hidden="true"><span>P</span><i /></span>
          <span><strong>PointGuide</strong><small>PCC technology support</small></span>
        </Link>
        <nav aria-label="Primary navigation">
          <ul className="rail-nav">
            {navigation.map((item) => (
              <li key={item.href}>
                <Link className={item.href === "/" ? "active" : undefined} href={item.href} aria-current={item.href === "/" ? "page" : undefined}>
                  <NavIcon name={item.icon} />
                  <span>{item.label}</span>
                  {item.restricted ? <small>{item.restricted}</small> : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="rail-status">
          <span className="status-dot" aria-hidden="true" />
          <span><strong>Corpus ready</strong><small>20 sources · M32</small></span>
        </div>
        <Link className="account-chip" href="/account">
          <span className="avatar" aria-hidden="true">CO</span>
          <span><strong>Current Owner</strong><small>Owner</small></span>
          <span aria-hidden="true">›</span>
        </Link>
      </aside>
      <div className="work-area">
        <header className="mobile-header">
          <Link className="brand compact" href="/" aria-label="PointGuide home">
            <span className="brand-mark" aria-hidden="true"><span>P</span><i /></span>
            <strong>PointGuide</strong>
          </Link>
          <Link className="avatar" href="/account" aria-label="Open account settings">CO</Link>
        </header>
        <main id="main-content">{children}</main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {navigation.slice(0, 3).map((item) => (
          <Link key={item.href} className={item.href === "/" ? "active" : undefined} href={item.href} aria-current={item.href === "/" ? "page" : undefined}>
            <NavIcon name={item.icon} /><span>{item.label}</span>
          </Link>
        ))}
        <Link href="/more"><span className="more-dots" aria-hidden="true">•••</span><span>More</span></Link>
      </nav>
    </div>
  );
}

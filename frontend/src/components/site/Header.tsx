"use client";
import React, { useEffect, useRef, useState } from "react";
import { NAV_LINKS } from "@/content/site";
import { MyProfile, PROFILE_EVENT, PROFILE_PATH, apiFetch, logout } from "@/lib/api";
import { AdminInstitution, fetchAdminInstitutions, membersPagePath } from "@/lib/portal";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";

function ProfileMenu({ user }: { user: MyProfile }) {
  const [open, setOpen] = useState(false);
  const [institutions, setInstitutions] = useState<AdminInstitution[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetchAdminInstitutions().then(setInstitutions);
  }, [user.id]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = user.name || user.email;
  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Profile menu for ${label}`}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] items-center gap-2.5 rounded-full border border-night-stroke py-1 pl-1 pr-3 text-sm text-fog hover:border-white hover:text-white"
      >
        <Avatar name={user.name} email={user.email} url={user.avatar_url} size={34} />
        <span data-testid="authenticated-user" className="max-w-[160px] truncate">
          {label}
        </span>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Profile"
          className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-2xl border border-line bg-white text-ink shadow-lg"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate font-semibold">{user.name || "Your account"}</p>
            <p className="truncate text-sm text-muted">{user.email}</p>
          </div>
          <a role="menuitem" href="/profile" className="flex min-h-[48px] items-center gap-3 px-4 hover:bg-ground">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
            My profile
          </a>
          {institutions.map((i) => (
            <a key={i.slug} role="menuitem" href={membersPagePath(i.slug)} className="flex min-h-[48px] items-center gap-3 px-4 py-2 hover:bg-ground">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
                <circle cx="9" cy="8" r="3.5" />
                <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.2.6 3.5 2.8 3.5 6" />
              </svg>
              <span className="min-w-0">
                Manage members
                <span className="block truncate text-sm text-muted">{i.name}</span>
              </span>
            </a>
          ))}
          <button
            role="menuitem"
            type="button"
            onClick={() => logout()}
            className="flex min-h-[48px] w-full items-center gap-3 border-t border-line px-4 text-left hover:bg-ground"
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
            </svg>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function Header({ current }: { current?: string }) {
  const [user, setUser] = useState<MyProfile | null>(null);

  useEffect(() => {
    apiFetch<MyProfile>(PROFILE_PATH)
      .then(setUser)
      .catch(() => setUser(null));
    const onChange = (e: Event) => setUser((e as CustomEvent<MyProfile>).detail);
    window.addEventListener(PROFILE_EVENT, onChange);
    return () => window.removeEventListener(PROFILE_EVENT, onChange);
  }, []);

  return (
    <header className="border-b border-night-line bg-night">
      <div className="mx-auto flex min-h-[72px] max-w-site flex-wrap items-center justify-between gap-4 px-6 py-3">
        <Logo />
        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-7 gap-y-2 text-[15px] font-medium">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              aria-current={current === l.href ? "page" : undefined}
              className={current === l.href ? "text-white" : "text-fog hover:text-white"}
            >
              {l.label}
            </a>
          ))}
        </nav>
        {user ? (
          <ProfileMenu user={user} />
        ) : (
          <a href="/sign-in" className="btn-primary min-h-[44px] px-5 text-[15px]">
            Sign in with BdREN
          </a>
        )}
      </div>
    </header>
  );
}

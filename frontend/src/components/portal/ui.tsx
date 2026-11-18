"use client";
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type Notice = { tone: "ok" | "error"; text: string } | null;

const CHIP_LABELS: Record<string, string> = {
  active: "Active",
  suspended: "Suspended",
  pending: "Pending",
  deprovisioned: "Removed",
  accepted: "Accepted",
  revoked: "Revoked",
  expired: "Expired",
};

export function Chip({ status }: { status: string }) {
  const tone =
    status === "active" || status === "accepted"
      ? "bg-ink text-white"
      : status === "pending"
        ? "bg-brand-tint text-brand-strong"
        : "border border-field text-muted";
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${tone}`}>
      {CHIP_LABELS[status] || status}
    </span>
  );
}

export function Banner({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  if (!notice) return null;
  const error = notice.tone === "error";
  return (
    <div
      role={error ? "alert" : "status"}
      className={`flex items-start justify-between gap-4 rounded-xl border px-4 py-3 ${error ? "border-brand bg-brand-tint text-brand-strong" : "border-line bg-white text-ink"}`}
    >
      <p>{notice.text}</p>
      <button type="button" onClick={onClose} aria-label="Dismiss message" className="min-h-[28px] min-w-[28px] font-semibold">
        ×
      </button>
    </div>
  );
}

export function Pager({ page, pageSize, count, onPage }: {
  page: number;
  pageSize: number;
  count: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3 text-[15px]">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} className="btn-outline min-h-[40px] px-4 disabled:cursor-not-allowed disabled:opacity-40">
        Previous
      </button>
      <span className="text-muted">
        Page {page} of {pages}
      </span>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} className="btn-outline min-h-[40px] px-4 disabled:cursor-not-allowed disabled:opacity-40">
        Next
      </button>
    </nav>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab cycling through the focusable elements inside `box`. */
function trapTab(e: KeyboardEvent, box: HTMLElement) {
  const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
  const active = document.activeElement;
  const outside = !box.contains(active);
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const edge = e.shiftKey ? items[0] : items[items.length - 1];
  if (outside || active === edge) {
    e.preventDefault();
    (e.shiftKey ? items[items.length - 1] : items[0]).focus();
  }
}

/** Marks every other child of <body> `inert` (no focus, clicks or screen-reader access); returns the undo. */
function isolate(overlay: HTMLElement): () => void {
  const others = Array.from(document.body.children).filter((el) => el !== overlay && !el.hasAttribute("inert"));
  others.forEach((el) => el.setAttribute("inert", ""));
  return () => others.forEach((el) => el.removeAttribute("inert"));
}

/**
 * Modal dialog, rendered at the end of <body>: the page behind it is inert, Tab stays inside it, it focuses its
 * first control, closes on Escape or a backdrop click, and gives focus back on close.
 */
export function Dialog({ title, onClose, children, wide = false }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const restore = overlay.current ? isolate(overlay.current) : () => undefined;
    box.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab" && box.current) trapTab(e, box.current);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restore();
      opener?.focus();
    };
  }, []);

  return createPortal(
    <div ref={overlay} className="fixed inset-0 z-40 flex items-center justify-center bg-ink/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className={`card max-h-[90vh] w-full overflow-y-auto p-6 md:p-8 ${wide ? "max-w-[760px]" : "max-w-[480px]"}`}
      >
        <h2 id="dialog-title" className="font-display text-2xl font-bold">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({ title, body, action, busy, onConfirm, onClose }: {
  title: string;
  body: string;
  action: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="mt-3 leading-relaxed text-muted">{body}</p>
      <div className="mt-7 flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onClose} className="btn-outline">
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={busy} className="btn-primary disabled:cursor-not-allowed disabled:opacity-60">
          {busy ? "Working…" : action}
        </button>
      </div>
    </Dialog>
  );
}

export const selectClass = "input min-h-[44px] w-auto cursor-pointer py-0 pr-8 text-[15px]";
export const thClass = "border-b border-line px-4 py-3 text-left font-semibold";
export const tdClass = "border-b border-ground px-4 py-3 align-top";
export const linkButton = "min-h-[36px] font-semibold text-brand-text hover:text-brand-strong disabled:cursor-not-allowed disabled:opacity-40";

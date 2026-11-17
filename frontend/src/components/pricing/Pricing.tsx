"use client";
import React, { useState } from "react";
import type { Listing } from "@/content/pricing";
import { PRODUCTS } from "@/content/products";
import { PRODUCT_LISTINGS, SUITE } from "@/content/pricing";
import { CompareTable } from "./CompareTable";
import { PlanGrid } from "./PlanCard";

type Mode = "suite" | "single";

const MODES: { id: Mode; label: string; sub: string }[] = [
  { id: "suite", label: "BdREN AI Suite", sub: "All 4 products, one plan" },
  { id: "single", label: "A single product", sub: "Buy only what you need" },
];

export function Pricing({ initialMode = "suite" }: { initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [picked, setPicked] = useState<string>(PRODUCT_LISTINGS[0].id);
  const isSuite = mode === "suite";
  const listing: Listing = isSuite ? SUITE : PRODUCT_LISTINGS.find((l) => l.id === picked) || PRODUCT_LISTINGS[0];

  return (
    <>
      <div className="mt-10 text-center">
        <div
          role="group"
          aria-label="Package type"
          className="inline-flex flex-wrap justify-center gap-1.5 rounded-2xl border border-line bg-white p-1.5"
        >
          {MODES.map((m) => {
            const on = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={on}
                onClick={() => setMode(m.id)}
                className={`min-h-[56px] rounded-xl px-5 py-2 text-left ${on ? "bg-ink text-white" : "text-ink hover:bg-ground"}`}
              >
                <span className="block font-semibold">{m.label}</span>
                <span className={`mt-0.5 block text-[13px] font-medium ${on ? "text-mist" : "text-muted"}`}>{m.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      {isSuite ? (
        <ul aria-label="Included in the Suite" className="mx-auto mt-10 grid max-w-site gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PRODUCTS.map((p) => (
            <li key={p.slug} className="flex items-center gap-3.5 rounded-[14px] border border-line bg-white px-4 py-4">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-ink font-display font-bold text-white"
              >
                {p.initial}
              </span>
              <span>
                <strong className="block">{p.name}</strong>
                <span className="mt-0.5 block text-sm text-muted">{p.line}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-10 text-center">
          <div role="group" aria-label="Product" className="inline-flex flex-wrap justify-center gap-1.5 rounded-[14px] bg-line/60 p-1.5">
            {PRODUCT_LISTINGS.map((l) => {
              const on = l.id === listing.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked(l.id)}
                  className={`min-h-[44px] rounded-[10px] px-4 text-[15px] font-semibold ${on ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
          <p className="mx-auto mt-5 max-w-[720px] text-muted">{listing.blurb}</p>
        </div>
      )}

      <div className="mx-auto mt-8 max-w-site">
        <PlanGrid plans={listing.plans} />
        <p className="mt-5 text-center text-[15px] text-muted">
          {isSuite ? "Only need one product?" : "Need more than one product?"}{" "}
          <button
            type="button"
            onClick={() => setMode(isSuite ? "single" : "suite")}
            className="min-h-[44px] px-1.5 font-semibold text-brand-text hover:text-brand-strong"
          >
            {isSuite ? "See single-product packages" : "See the BdREN AI Suite"}
          </button>
        </p>
      </div>

      <section aria-labelledby="cmp-title" className="mx-auto mt-20 max-w-site">
        <h2 id="cmp-title" className="font-display text-3xl font-bold">
          Compare {listing.label} plans
        </h2>
        <CompareTable listing={listing} />
      </section>
    </>
  );
}

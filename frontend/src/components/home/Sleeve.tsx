"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { PRODUCTS } from "@/content/products";

const FORMATS = ["mp4", "webm"];
/** The clips in public/videos are labelled placeholders until real product recordings replace them. */
const SAMPLE_CLIPS = true;

function Tick() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-1 flex-none"
    >
      <path d="M4 12.5l5 5L20 6" />
    </svg>
  );
}

/**
 * The home page's first screen: one flat ground per product, the product's clip printed into that ground,
 * the four products as a short track list, and an overview card for the chosen one.
 */
export function Sleeve() {
  const [index, setIndex] = useState(0);
  const [hasClip, setHasClip] = useState(false);
  const [paused, setPaused] = useState(false);
  const clip = useRef<HTMLVideoElement>(null);
  const calm = useRef(false);
  const product = PRODUCTS[index];

  const load = useCallback((slug: string, attempt = 0) => {
    const v = clip.current;
    if (!v) return;
    setHasClip(false);
    if (attempt >= FORMATS.length) {
      v.removeAttribute("src");
      return;
    }
    v.onerror = () => load(slug, attempt + 1);
    v.onloadeddata = () => {
      setHasClip(true);
      if (calm.current) {
        setPaused(true);
        return;
      }
      v.play()
        .then(() => setPaused(false))
        .catch(() => setPaused(true));
    };
    v.src = `/videos/${slug}.${FORMATS[attempt]}`;
    v.load();
  }, []);

  useEffect(() => {
    calm.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    load(product.slug);
  }, [product.slug, load]);

  function toggle() {
    const v = clip.current;
    if (!v) return;
    if (v.paused) {
      v.play().then(() => setPaused(false)).catch(() => setPaused(true));
    } else {
      v.pause();
      setPaused(true);
    }
  }

  return (
    <section
      aria-labelledby="sleeve-title"
      className={`sleeve relative overflow-hidden text-white ${hasClip ? "has-clip" : ""}`}
      style={{ "--ground": product.color } as React.CSSProperties}
    >
      <div aria-hidden="true" className="sleeve-bg">
        <video ref={clip} muted loop playsInline preload="metadata" />
      </div>

      <div className="relative z-10 mx-auto grid max-w-site gap-10 px-6 pb-14 pt-32 md:pt-36 lg:min-h-[100svh] lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)] lg:gap-16">
        <div className="flex min-w-0 flex-col">
          <h1
            id="sleeve-title"
            className="font-display text-[68px] font-bold leading-[0.86] tracking-[-0.04em] sm:text-[104px] lg:text-[clamp(104px,10.5vw,160px)]"
          >
            BdREN AI
          </h1>
          <p className="mt-5 max-w-[34ch] font-display text-xl font-medium leading-snug md:text-2xl">
            Four AI tools for Bangladesh&apos;s universities and offices. One account plays them all.
            <span lang="bn" className="mt-2 block font-bengali text-[0.9em]">
              বাংলা ও ইংরেজিতে
            </span>
          </p>

          <ol id="products" aria-label="Products" className="mt-10 max-w-[580px] scroll-mt-24 lg:mt-auto">
            {PRODUCTS.map((p, i) => {
              const on = i === index;
              return (
                <li key={p.slug} className="border-t-2 border-white/50 last:border-b-2">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setIndex(i)}
                    className={`track grid min-h-[52px] w-full grid-cols-[34px_1fr_auto] items-baseline gap-2 py-2.5 text-left font-display ${on ? "is-on" : ""}`}
                  >
                    <span className="track-num flex h-7 w-7 items-center justify-center self-center rounded-full text-sm font-semibold">
                      {i + 1}
                    </span>
                    <span className="track-name text-[22px] font-medium md:text-[27px]">{p.name}</span>
                    <span className="text-[15px] font-medium">{p.category}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="flex flex-col items-stretch justify-end gap-4 lg:items-end">
          <article aria-live="polite" className="w-full rounded-[28px] bg-white p-7 text-ink shadow-[0_24px_50px_-24px_rgba(20,19,28,0.55)] lg:max-w-[400px]">
            <div key={product.slug} className="sleeve-swap">
              <h2 className="font-display text-4xl font-bold leading-none tracking-tight md:text-[44px]">{product.name}</h2>
              <p className="mt-3 leading-relaxed text-muted">{product.summary}</p>
              <ul className="mt-4 grid gap-2 text-[15px] leading-snug">
                {product.points.map((pt) => (
                  <li key={pt} className="flex gap-2.5">
                    <Tick />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
            <a href={`/products/${product.slug}`} className="btn-primary mt-6 gap-3">
              Open {product.name}
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
          </article>
          {hasClip && (
            <div className="flex items-center justify-end gap-3 self-end">
              {SAMPLE_CLIPS && <p className="text-sm font-semibold">Sample clip, not product footage</p>}
            <button
              type="button"
              onClick={toggle}
              aria-label={paused ? "Play background video" : "Pause background video"}
              className="flex h-12 w-12 flex-none items-center justify-center rounded-full border-2 border-white text-white transition-colors hover:bg-white hover:text-ink"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d={paused ? "M8 5v14l11-7z" : "M7 5h4v14H7zM13 5h4v14h-4z"} />
              </svg>
            </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

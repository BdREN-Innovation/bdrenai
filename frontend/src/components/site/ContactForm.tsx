"use client";
import React, { useState } from "react";
import { PRODUCTS } from "@/content/products";
import { CONTACT } from "@/content/site";

const SUITE_OPTION = "BdREN AI Suite (all products)";
const OPTIONS = [SUITE_OPTION, ...PRODUCTS.map((p) => p.name), "Not sure yet"];

/** No contact API exists yet, so the form opens the visitor's email app with the message filled in. */
export function ContactForm() {
  const [sent, setSent] = useState(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const field = (k: string) => String(data.get(k) || "").trim();
    const subject = `BdREN AI enquiry: ${field("product")}`;
    const body = [
      `Name: ${field("name")}`,
      `Email: ${field("email")}`,
      `Institution: ${field("institution")}`,
      `Product: ${field("product")}`,
      "",
      field("message"),
    ].join("\n");
    window.location.href = `mailto:${CONTACT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
  }

  return (
    <form
      aria-label="Contact form"
      onSubmit={submit}
      className="card grid min-w-0 flex-[1_1_560px] gap-5 rounded-[20px] p-7 sm:grid-cols-2 md:p-9"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="c-name" className="text-[15px] font-semibold">
          Name
        </label>
        <input id="c-name" name="name" type="text" autoComplete="name" required className="input min-h-[48px]" />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="c-email" className="text-[15px] font-semibold">
          Work email
        </label>
        <input id="c-email" name="email" type="email" autoComplete="email" required className="input min-h-[48px]" />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="c-org" className="text-[15px] font-semibold">
          Institution
        </label>
        <input id="c-org" name="institution" type="text" autoComplete="organization" className="input min-h-[48px]" />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="c-product" className="text-[15px] font-semibold">
          Product
        </label>
        <select id="c-product" name="product" className="input min-h-[48px]">
          {OPTIONS.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <label htmlFor="c-msg" className="text-[15px] font-semibold">
          Message
        </label>
        <textarea id="c-msg" name="message" rows={5} required className="input resize-y py-3 leading-normal" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 sm:col-span-2">
        <p className="text-sm text-muted" role={sent ? "status" : undefined}>
          {sent
            ? `Your email app should open with the message. If not, write to ${CONTACT.email}.`
            : "We use your details only to reply."}
        </p>
        <button type="submit" className="btn-primary min-h-[52px]">
          Send message
        </button>
      </div>
    </form>
  );
}

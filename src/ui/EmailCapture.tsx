"use client";

import { useState, type FormEvent } from "react";

/**
 * Inline list signup.
 *
 * Renders only when NEXT_PUBLIC_EMAIL_FORM_ACTION is set, so the page never
 * shows a form that silently drops addresses. Point it at a provider's raw
 * form endpoint (Loops, ConvertKit, Buttondown all give you one) and it posts
 * straight there — no API route, no backend, nothing stored here.
 */
const ACTION = process.env.NEXT_PUBLIC_EMAIL_FORM_ACTION;

export default function EmailCapture() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  if (!ACTION) return null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = new FormData(form).get("email");
    if (typeof email !== "string" || !email.includes("@")) return;

    setState("sending");
    try {
      const res = await fetch(ACTION!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setState(res.ok ? "done" : "error");
      if (res.ok) form.reset();
    } catch {
      setState("error");
    }
  }

  return (
    <section>
      <h2>New tools</h2>
      {state === "done" ? (
        <p className="hint" role="status">
          Thanks — you&rsquo;ll hear when the next one ships.
        </p>
      ) : (
        <form onSubmit={onSubmit}>
          <label className="field">
            <span>Get told when I ship the next tool</span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              disabled={state === "sending"}
            />
          </label>
          <button
            className="btn"
            type="submit"
            style={{ marginTop: 10 }}
            disabled={state === "sending"}
          >
            {state === "sending" ? "Sending…" : "Keep me posted"}
          </button>
          {state === "error" && (
            <p className="hint" role="status">
              That didn&rsquo;t go through. Try again in a moment.
            </p>
          )}
        </form>
      )}
    </section>
  );
}

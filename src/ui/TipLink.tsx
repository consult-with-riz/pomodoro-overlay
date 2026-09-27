"use client";

/**
 * A quiet way to tip.
 *
 * Points at a Stripe Payment Link — a hosted checkout page created in the
 * Stripe dashboard. No API routes, no webhook, no secret key in this app, and
 * nothing to store, so the page keeps its "no backend, nothing uploaded"
 * claim intact. A tip buys nothing and unlocks nothing; there is no account
 * to attach an entitlement to and pretending otherwise would be dishonest.
 *
 * Renders only when NEXT_PUBLIC_TIP_URL is set, so there is never a support
 * button that leads nowhere.
 */

const TIP_URL = process.env.NEXT_PUBLIC_TIP_URL;

export function tipEnabled(): boolean {
  return Boolean(TIP_URL);
}

interface Props {
  /**
   * "moment" is for just after the app did something useful — a finished
   * session, a saved render. "quiet" is the standing link in settings.
   */
  variant?: "moment" | "quiet";
  children?: React.ReactNode;
}

export default function TipLink({ variant = "quiet", children }: Props) {
  if (!TIP_URL) return null;

  return (
    <a
      className={`tip tip--${variant}`}
      href={TIP_URL}
      // Stripe's page is a different origin; noreferrer keeps this one out of
      // its referrer header, and a new tab means a running timer is not lost.
      target="_blank"
      rel="noopener noreferrer"
    >
      {children ?? "Tip if it helped"}
      <span aria-hidden="true"> →</span>
    </a>
  );
}

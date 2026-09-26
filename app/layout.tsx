import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const title = "Pomodoro timer and overlay maker";
const description =
  "A Pomodoro timer that renders itself as a video overlay — green screen, blue screen, or WebM with real transparency. Runs entirely in your browser. Nothing is uploaded.";

/**
 * Absolute base for og:image and friends.
 *
 * Without this Next falls back to localhost:3000 and every social preview
 * breaks. NEXT_PUBLIC_SITE_URL is the custom domain once there is one;
 * VERCEL_PROJECT_PRODUCTION_URL covers deploys before then.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  applicationName: "Pomodoro overlay maker",
  openGraph: {
    title,
    description,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* The pinned faces, served from public/. font-display:block so the
            renderer never paints a frame with a fallback glyph. */}
        <link rel="stylesheet" href="/fonts/fonts.css" />
      </head>
      <body>
        {children}
        {/* Page counts only. No cookies, and nothing about a session leaves
            the browser — the whole point of the tool is that it can't. */}
        <Analytics />
      </body>
    </html>
  );
}

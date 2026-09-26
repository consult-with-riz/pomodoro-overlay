import { ImageResponse } from "next/og";

export const alt = "Pomodoro timer and overlay maker";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social preview.
 *
 * Deliberately uses the default font stack rather than the app's four faces:
 * ImageResponse needs TTF/OTF/WOFF and the pinned files are WOFF2, so pulling
 * them in would mean shipping a second copy of each font purely for this card.
 */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#16201C",
          color: "#E6EBE8",
          padding: 72,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 640 }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -1.5,
            }}
          >
            Pomodoro timer and overlay maker
          </div>
          <div style={{ fontSize: 30, color: "#9CA9A3", marginTop: 26, lineHeight: 1.35 }}>
            Render the timer as a green screen MP4 or a WebM with real
            transparency. Runs entirely in your browser.
          </div>
          <div style={{ fontSize: 24, color: "#FF5A3C", marginTop: 32, fontWeight: 600 }}>
            Nothing is uploaded.
          </div>
        </div>

        {/* The ring, at the same proportions the renderer draws it. */}
        <div style={{ display: "flex", position: "relative" }}>
          <svg width="340" height="340" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="44" fill="none" stroke="#33403A" strokeWidth="6" />
            <path
              d="M50 6 a44 44 0 0 1 38.1 22"
              fill="none"
              stroke="#FF5A3C"
              strokeWidth="6"
              strokeLinecap="round"
            />
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 76,
              fontWeight: 700,
            }}
          >
            25:00
          </div>
        </div>
      </div>
    ),
    size
  );
}

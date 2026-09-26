import type { Metadata } from "next";
import ToolLoader from "@/src/ui/ToolLoader";

/**
 * The overlay maker — the creator tool.
 *
 * Targets "green screen timer overlay" and similar, which is a different
 * search intent from the focus timer at /.
 */
export const metadata: Metadata = {
  title: "Pomodoro timer overlay maker — green screen and transparent video",
  description:
    "Render a Pomodoro timer as a green screen MP4 or a WebM with real transparency, to lay over your footage in Premiere, Final Cut, DaVinci Resolve or OBS. Encodes in your browser — nothing is uploaded.",
  alternates: { canonical: "/overlay" },
  openGraph: {
    title: "Pomodoro timer overlay maker",
    description:
      "Render a Pomodoro timer as a green screen MP4 or a WebM with real transparency, to lay over your footage.",
    type: "website",
  },
};

export default function Page() {
  return <ToolLoader />;
}

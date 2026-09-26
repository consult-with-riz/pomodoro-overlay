import type { Metadata } from "next";
import FocusLoader from "@/src/ui/FocusLoader";
import "./focus.css";

/**
 * The focus timer — the front door.
 *
 * Targets the broad "pomodoro timer" intent. The creator tool lives at
 * /overlay and targets a completely different search, which is the reason
 * these are two routes rather than one page with a mode switch.
 */
export const metadata: Metadata = {
  title: "Pomodoro timer — focus, breaks, and a bell",
  description:
    "A calm Pomodoro timer that runs in your browser. Presets, phase-aware backgrounds, brown noise, and a bell at every switch. No account, nothing uploaded.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Pomodoro timer — focus, breaks, and a bell",
    description:
      "A calm Pomodoro timer that runs in your browser. Presets, phase-aware backgrounds, brown noise, and a bell at every switch.",
    type: "website",
  },
};

export default function Page() {
  return <FocusLoader />;
}

"use client";

import dynamic from "next/dynamic";

/**
 * Keeps the focus timer out of server rendering.
 *
 * AudioContext, localStorage and the wake lock do not exist on the server, and
 * a "use client" component is still prerendered there unless it is pulled in
 * with ssr:false — which is only honoured from inside a Client Component.
 */
const Focus = dynamic(() => import("./Focus"), {
  ssr: false,
  loading: () => (
    <main className="focus focus--booting">
      <div />
      <section className="focus__stage">
        <div className="dial" />
      </section>
      <div />
    </main>
  ),
});

export default function FocusLoader() {
  return <Focus />;
}

"use client";

import dynamic from "next/dynamic";

/**
 * Keeps the tool out of server rendering.
 *
 * WebCodecs, AudioContext and canvas do not exist on the server, and a
 * "use client" component is still prerendered there unless it is pulled in
 * with ssr:false. That option is only honoured inside a Client Component,
 * which is the entire reason this file exists between the page and the tool.
 */
const Tool = dynamic(() => import("./Tool"), {
  ssr: false,
  loading: () => (
    <div className="app">
      <header className="head">
        <div className="brand">
          <a className="wordmark" href="https://aiwithriz.com">
            Riz
          </a>
          <h1>Pomodoro timer</h1>
          <p>Loading…</p>
        </div>
      </header>
    </div>
  ),
});

export default function ToolLoader() {
  return <Tool />;
}

/**
 * Placeholder shell for Phase 1 only.
 *
 * The real landing page — URL input, validation, suggested playlists — is Phase 6
 * work with its own error states. This exists to prove the React root mounts and
 * that Tailwind utility classes actually apply, and is expected to be replaced
 * wholesale rather than grown into the landing screen.
 */
export default function App() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-neutral-950 p-6 text-neutral-100">
      <h1 className="text-3xl font-bold tracking-tight">Custom Hitster</h1>
      <p className="text-sm text-neutral-400">
        Phase 1 skeleton — the deck arrives in a later phase.
      </p>
    </main>
  );
}

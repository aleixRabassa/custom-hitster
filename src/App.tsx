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
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-neutral-950 p-6 text-neutral-100">
      <img src="/logo.png" alt="Custom Hitster" className="w-48 max-w-full sm:w-64" />
      <p className="text-sm text-neutral-400">Work in progress — check back soon.</p>
    </main>
  );
}

/**
 * The transient "Developer mode on / off" message (2026-10-19).
 *
 * A `fixed` overlay, never in flow: the picker and the welcome screen pin the logo at `pt-8`, and a
 * message that took space would push it. `pointer-events-none` so it never eats a tap, and no
 * dismiss button (it would change both screens' exact button counts) -- the container's
 * `useTimedDismiss` fades it. Rendered only while there is a message, so the one `role="status"`
 * it adds exists only for the seconds it is meant to be heard.
 */

export interface DevModeToastProps {
  message: string;
  /** The container's timed dismiss has started the fade. */
  isFading?: boolean;
}

export function DevModeToast({ message, isFading = false }: DevModeToastProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center px-6">
      <div
        role="status"
        data-testid="dev-mode-toast"
        className={`rounded-lg border border-border-strong bg-surface-raised px-4 py-2 text-sm text-fg transition-opacity duration-(--duration-notice-fade) ${
          isFading ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {message}
      </div>
    </div>
  );
}

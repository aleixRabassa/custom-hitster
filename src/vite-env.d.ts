/// <reference types="vite/client" />

/**
 * The `VITE_*` variables the browser bundle reads. Vite inlines them at BUILD time, so each one is
 * a redeploy to change. Annotated in `.env.example`.
 */
interface ImportMetaEnv {
  /** `off` skips the suggested playlists' preloaded years (`preloaded-years.ts`). Load tests only. */
  readonly VITE_PRELOADED_YEARS?: string;
}

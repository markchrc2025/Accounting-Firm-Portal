/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Runtime config injected by the web container's entrypoint (see public/env.js). */
interface Window {
  __PORTAL_ENV__?: { API_BASE_URL?: string };
}

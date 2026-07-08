// Runtime config placeholder. In production the web container's entrypoint
// overwrites this file from the API_BASE_URL env var. In local dev it is a
// no-op and the app falls back to VITE_API_BASE_URL / the default.
window.__PORTAL_ENV__ = window.__PORTAL_ENV__ || {};

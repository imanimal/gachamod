import posthogClient from "posthog-js/dist/module.full.no-external";

const key = import.meta.env.VITE_POSTHOG_KEY;
const host = import.meta.env.VITE_POSTHOG_HOST;
const missingVariable = !key ? "VITE_POSTHOG_KEY" : !host ? "VITE_POSTHOG_HOST" : null;

if (missingVariable && import.meta.env.DEV) {
  throw new Error(`${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`);
}

if (key && host) {
  posthogClient.init(key, {
    api_host: host,
    defaults: "2026-08-30",
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    logs: {
      serviceName: "gachamod-desktop",
      environment: import.meta.env.MODE,
    },
  });
}

export const posthog = key && host ? posthogClient : null;
export const posthogLogger = posthog?.logger ?? null;

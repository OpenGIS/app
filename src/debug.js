/**
 * Development debug logger. No-ops in production builds.
 *
 * Usage:
 *   import { createDebug } from "@/debug.js";
 *   const debug = createDebug("wake-lock");
 *   debug.log("acquired", sentinel);
 *   debug.warn("request denied", err);
 *   debug.error("unexpected state");
 *
 * Logs are prefixed with [onrte:namespace] for easy filtering in DevTools:
 *   Filter: [onrte:wake-lock]
 */

const isDev = import.meta.env.DEV;

export const createDebug = (namespace) => {
  const prefix = `[onrte:${namespace}]`;
  return {
    log: isDev ? (...args) => console.log(prefix, ...args) : () => {},
    warn: isDev ? (...args) => console.warn(prefix, ...args) : () => {},
    error: isDev ? (...args) => console.error(prefix, ...args) : () => {},
  };
};

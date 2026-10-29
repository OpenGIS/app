import { createDebug } from "@/debug.js";

const debug = createDebug("resilience");

/** @type {WeakSet<Object>} */
const installedTargets = new WeakSet();

const fallbackMessage = "Unknown error";

const normaliseError = (value) => {
  try {
    if (value instanceof Error) return value;

    if (typeof value === "string") {
      return new Error(value || fallbackMessage);
    }

    if (value && typeof value === "object") {
      let message = "";
      try {
        if (typeof value.message === "string" && value.message) {
          message = value.message;
        }
      } catch {
        message = "";
      }

      if (!message) {
        try {
          message = JSON.stringify(value);
        } catch {
          message = "";
        }
      }

      const error = new Error(message || fallbackMessage);
      try {
        if (typeof value.name === "string" && value.name) {
          error.name = value.name;
        }
      } catch {
        // Ignore — the normalised error remains usable.
      }
      return error;
    }

    return new Error(String(value));
  } catch {
    return new Error(fallbackMessage);
  }
};

const copyContext = (context) => {
  if (!context || typeof context !== "object") return {};
  const copy = {};
  try {
    for (const key of Object.keys(context)) {
      try {
        const value = context[key];
        if (value !== undefined) copy[key] = value;
      } catch {
        // Ignore a throwing getter.
      }
    }
  } catch {
    // Ignore an object that cannot be enumerated.
  }
  return copy;
};

/**
 * Report a contained error without throwing.
 *
 * Logging uses the development-only debug logger so the healthy path never
 * emits a console error. The normalised error is returned so callers can use it
 * for follow-up decisions.
 *
 * @param {*} error - Any thrown value.
 * @param {Object} [context] - Useful details such as source, feature or event.
 * @returns {Error} The normalised error.
 */
export const reportError = (error, context = {}) => {
  const normalised = normaliseError(error);

  try {
    debug.warn("contained error", copyContext(context), normalised);
  } catch {
    // Reporting itself must never throw.
  }

  return normalised;
};

const isScriptErrorEvent = (event) => {
  if (!event) return false;

  let error = null;
  try {
    error = event.error;
  } catch {
    error = null;
  }
  if (error) return true;

  try {
    return typeof event.message === "string" && event.message.length > 0;
  } catch {
    return false;
  }
};

/**
 * Install global window error handlers once per target.
 *
 * Resource-load failures (images, map tiles) have no error value and no
 * message, so they are deliberately ignored. `preventDefault()` is never
 * called: containment must not hide the browser's own diagnostics.
 *
 * @param {Object|null} [target] - Window-like target, injectable for tests.
 * @param {Object} [options]
 * @param {Function} [options.report] - Reporter, defaults to reportError.
 * @returns {boolean} True when handlers are installed for the target.
 */
export const installGlobalErrorHandlers = (
  target = typeof window !== "undefined" ? window : null,
  { report = reportError } = {},
) => {
  if (!target || typeof target.addEventListener !== "function") return false;
  if (installedTargets.has(target)) return false;

  installedTargets.add(target);

  try {
    target.addEventListener(
      "error",
      (event) => {
        if (!isScriptErrorEvent(event)) return;
        try {
          report(event?.error ?? event?.message, {
            source: "window",
            event: "error",
            message: event?.message,
            filename: event?.filename,
            lineno: event?.lineno,
            colno: event?.colno,
          });
        } catch {
          // A reporter must not break the browser's own error path.
        }
      },
      true,
    );

    target.addEventListener("unhandledrejection", (event) => {
      try {
        report(event?.reason, {
          source: "window",
          event: "unhandledrejection",
        });
      } catch {
        // A reporter must not break the browser's own rejection path.
      }
    });

    return true;
  } catch {
    return false;
  }
};

/**
 * Install a Vue error handler that contains component errors.
 *
 * @param {Object} app - Vue application instance.
 * @param {Object} [options]
 * @param {Function} [options.report] - Reporter, defaults to reportError.
 */
export const installVueErrorHandler = (app, { report = reportError } = {}) => {
  try {
    if (!app?.config) return;
    app.config.errorHandler = (error, instance, info) => {
      try {
        report(error, { source: "vue", info });
      } catch {
        // A reporter must not throw inside Vue's error path.
      }

      try {
        const isRoot =
          !instance || instance.$root === instance || instance.parent === null;
        if (isRoot) window.__ogisBoot?.fail?.(error);
      } catch {
        // The root check and the boot signal must not escape.
      }
    };
  } catch {
    // Leave Vue's default handler in place when configuration is unavailable.
  }
};

import { reportError } from "@/resilience/errors.js";

const safeReport = (report, error, context) => {
  try {
    report(error, context);
  } catch {
    // Reporting must never escape the resilience boundary.
  }
};

const trackDisposer = (disposers, result) => {
  if (typeof result === "function") disposers.push(result);
};

const disposeAll = (disposers, name, report) => {
  for (const dispose of [...disposers].reverse()) {
    try {
      dispose();
    } catch (error) {
      safeReport(report, error, {
        source: "feature-install-dispose",
        feature: name,
      });
    }
  }
};

/**
 * Install one feature inside an isolation boundary.
 *
 * Registrations made through the wrapped context are tracked. If install
 * throws, they are rolled back in reverse order before the error is reported,
 * so a broken feature cannot leave partial UI, listeners or feature-owned
 * cleanups behind. A successful install leaves `onCleanup` registrations with
 * `main.js`, where they run on app destroy. A teardown function returned by a
 * successful install is registered through the wrapped `onCleanup` for the
 * same reason, so it joins the feature cleanup registry and runs on destroy
 * rather than immediately. `provide` cannot be rolled back — Vue has no
 * unprovide — which is accepted here.
 *
 * @param {string} name - Stable feature name for reporting.
 * @param {{install: Function}} feature - Feature object.
 * @param {Object} baseContext - Context built in main.js.
 * @param {Object} [options]
 * @param {Function} [options.onError] - Reporter, defaults to reportError.
 * @returns {boolean} True when the feature installed successfully.
 */
export const installFeature = (
  name,
  feature,
  baseContext,
  { onError = reportError } = {},
) => {
  const disposers = [];

  if (!feature || typeof feature.install !== "function") {
    safeReport(
      onError,
      new TypeError(`Feature "${name}" does not expose install()`),
      { source: "feature-install", feature: name },
    );
    return false;
  }

  const context = {
    ...baseContext,
    addButton: (config) => {
      const result = baseContext.addButton?.(config);
      trackDisposer(disposers, result);
      return result;
    },
    addPanel: (config) => {
      const result = baseContext.addPanel?.(config);
      trackDisposer(disposers, result);
      return result;
    },
    on: (event, fn) => {
      const result = baseContext.on?.(event, fn);
      trackDisposer(disposers, result);
      return result;
    },
    once: (event, fn) => {
      const result = baseContext.once?.(event, fn);
      trackDisposer(disposers, result);
      return result;
    },
    onMapReady: (callback) => {
      const result = baseContext.onMapReady?.(callback);
      trackDisposer(disposers, result);
      return result;
    },
    onCleanup: (fn) => {
      const remove = baseContext.onCleanup?.(fn);
      if (typeof remove !== "function") return remove;

      let active = true;

      // Roll back the side effect and then unregister it from the base
      // registry, even when the cleanup itself throws.
      disposers.push(() => {
        if (!active) return;
        active = false;
        try {
          fn();
        } finally {
          remove();
        }
      });

      // An explicit removal cancels the rollback without running the cleanup.
      return () => {
        if (!active) return;
        active = false;
        remove();
      };
    },
  };

  try {
    const result = feature.install(context);

    // Register a returned teardown through the wrapped `onCleanup`, not the
    // base context directly, so it shares the rollback tracking and lifecycle
    // of every other feature-owned cleanup. Without a base `onCleanup` (minimal
    // test contexts) there is nowhere to register it; the install still
    // succeeds and the teardown is simply not owned by the app.
    if (
      typeof result === "function" &&
      typeof baseContext.onCleanup === "function"
    ) {
      context.onCleanup(result);
    }

    return true;
  } catch (error) {
    disposeAll(disposers, name, onError);
    safeReport(onError, error, { source: "feature-install", feature: name });
    return false;
  }
};

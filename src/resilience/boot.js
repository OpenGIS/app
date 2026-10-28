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
 * so a broken feature cannot leave partial UI or listeners behind. `provide`
 * cannot be rolled back — Vue has no unprovide — which is accepted here.
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
  };

  try {
    feature.install(context);
    return true;
  } catch (error) {
    disposeAll(disposers, name, onError);
    safeReport(onError, error, { source: "feature-install", feature: name });
    return false;
  }
};

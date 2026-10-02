import { inject } from "vue";
import { createDebug } from "@/debug.js";

const debug = createDebug("wake-lock");
const instances = new Map();

/**
 * Manages the Screen Wake Lock API for an app instance.
 *
 * Acquires a wake lock on first user interaction with the app container and
 * re-acquires it automatically whenever the page becomes visible again after
 * being hidden (e.g. tab switch, screen lock).
 *
 * Usage: call `init(el)` from onMounted, passing the root app element.
 */
export const useWakeLock = () => {
  const instanceId = inject("ogisAppId", "app");

  if (!instances.has(instanceId)) {
    instances.set(instanceId, {
      sentinel: null,
      activated: false,
    });
  }

  const s = instances.get(instanceId);
  const supported = "wakeLock" in navigator;

  const acquire = async () => {
    if (!supported) return;
    if (s.sentinel && !s.sentinel.released) return;
    debug.log("requesting screen wake lock", {
      isSecureContext: window.isSecureContext,
      visibilityState: document.visibilityState,
    });
    try {
      s.sentinel = await navigator.wakeLock.request("screen");
      debug.log("wake lock acquired", {
        type: s.sentinel.type,
        released: s.sentinel.released,
      });
      s.sentinel.addEventListener("release", () => {
        debug.log("wake lock released", {
          visibilityState: document.visibilityState,
        });
        s.sentinel = null;
      });
    } catch (err) {
      debug.warn("wake lock request denied", {
        name: err.name,
        message: err.message,
      });
    }
  };

  const onVisibilityChange = () => {
    debug.log("visibilitychange", {
      visibilityState: document.visibilityState,
      activated: s.activated,
      hasSentinel: !!s.sentinel,
    });
    if (s.activated && document.visibilityState === "visible") {
      acquire();
    }
  };

  const init = () => {
    debug.log("init", {
      supported,
      isSecureContext: window.isSecureContext,
      protocol: location.protocol,
      visibilityState: document.visibilityState,
      userAgent: navigator.userAgent,
    });

    if (!supported) {
      debug.warn("Wake Lock API not supported in this browser");
      return;
    }

    // Re-request on every click so the lock is silently re-acquired after
    // any browser-initiated release (power-saving, brief visibility loss, etc.)
    window.addEventListener("click", () => {
      s.activated = true;
      acquire();
    });

    document.addEventListener("visibilitychange", onVisibilityChange);
  };

  return { init };
};

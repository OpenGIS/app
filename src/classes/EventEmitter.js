/**
 * Lightweight event emitter for ogis.app.
 *
 * Supports on/off/emit with optional one-time listeners via once().
 */
export default class EventEmitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Register a listener for an event.
   * @param {string} event
   * @param {Function} fn
   * @returns {this}
   */
  on(event, fn) {
    if (typeof fn !== "function") return this;
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(fn);
    return this;
  }

  /**
   * Register a one-time listener that unregisters after the first call.
   * @param {string} event
   * @param {Function} fn
   * @returns {this}
   */
  once(event, fn) {
    if (typeof fn !== "function") return this;
    const wrapper = (...args) => {
      this.off(event, wrapper);
      fn(...args);
    };
    wrapper._original = fn;
    return this.on(event, wrapper);
  }

  /**
   * Remove a specific listener, or all listeners for an event if fn is omitted.
   * @param {string} event
   * @param {Function} [fn]
   * @returns {this}
   */
  off(event, fn) {
    if (!fn) {
      this._listeners.delete(event);
      return this;
    }
    const set = this._listeners.get(event);
    if (!set) return this;
    // Check for direct match or a once() wrapper
    for (const listener of set) {
      if (listener === fn || listener._original === fn) {
        set.delete(listener);
        break;
      }
    }
    if (set.size === 0) this._listeners.delete(event);
    return this;
  }

  /**
   * Emit an event, calling all registered listeners with the provided arguments.
   * @param {string} event
   * @param {...*} args
   * @returns {this}
   */
  emit(event, ...args) {
    const set = this._listeners.get(event);
    if (!set) return this;
    for (const fn of [...set]) {
      fn(...args);
    }
    return this;
  }
}

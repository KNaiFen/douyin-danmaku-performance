export function installHook(scope, Replacement, diagnostics) {
  const wrapped = new WeakSet();
  const arrays = new WeakSet();
  const signature = source => source.includes('updateComments') && source.includes('setFontSize') && source.includes('readDataV1') && source.includes('bulletCreateEl');
  function patch(chunk) {
    const modules = chunk?.[1];
    if (!modules || typeof modules !== 'object') return;
    for (const id of Object.keys(modules)) {
      const original = modules[id];
      if (typeof original !== 'function' || wrapped.has(original)) continue;
      // IDs are only hints; the semantic fingerprint also protects against ID reuse.
      const source = Function.prototype.toString.call(original);
      if (source.length < 30000 || !signature(source)) continue;
      const factory = function(module, exports, require) {
        original.call(this, module, exports, require);
        const Original = module.exports;
        if (typeof Original !== 'function' || typeof Original.prototype?.updateComments !== 'function') {
          diagnostics.incompatible++;
          return;
        }
        module.exports = new Proxy(Original, {
          construct(Target, args) {
            try {
              const result = new Replacement(...args);
              diagnostics.replaced++;
              return result;
            } catch (error) {
              diagnostics.fallbacks++;
              console.warn('[DY Danmaku] Replacement unavailable, retaining original engine', error);
              return Reflect.construct(Target, args);
            }
          },
        });
        diagnostics.modules.push(String(id));
      };
      wrapped.add(factory);
      modules[id] = factory;
    }
  }
  function wrapArray(array) {
    if (!Array.isArray(array) || arrays.has(array)) return array;
    arrays.add(array);
    array.forEach(patch);
    const wrapPush = delegate => function(...chunks) {
      chunks.forEach(patch);
      return Reflect.apply(delegate, this, chunks);
    };
    let wrappedPush = wrapPush(array.push);
    // Rspack replaces push during bootstrap; keep intercepting its new callback.
    Object.defineProperty(array, 'push', {
      configurable: true,
      get: () => wrappedPush,
      set: value => {
        if (value === wrappedPush) return;
        // Each getter returns a closure with a fixed delegate. The old wrapper
        // captured by Rspack still calls Array.push, never the new runtime.
        wrappedPush = wrapPush(value);
      },
    });
    return array;
  }
  let array = wrapArray(scope.webpackChunkdouyin_web || []);
  const descriptor = Object.getOwnPropertyDescriptor(scope, 'webpackChunkdouyin_web');
  if (descriptor && !descriptor.configurable) { wrapArray(scope.webpackChunkdouyin_web); return; }
  Object.defineProperty(scope, 'webpackChunkdouyin_web', {
    configurable: true,
    enumerable: true,
    get: () => array,
    set: value => { array = wrapArray(value); },
  });
}

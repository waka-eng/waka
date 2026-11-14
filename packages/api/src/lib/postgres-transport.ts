/** postgres-js unsafe() defaults prepare:false independently of its pool.
 * The prepared root and bound-query opt-in are both necessary for cached SQL
 * to skip description. A first preparation still needs that exchange. */
export function preparedPostgresClient<T extends object>(client: T): T {
  if ((client as { options?: { prepare?: boolean } }).options?.prepare !== true) {
    throw new Error('Prepared transport requires a prepared root client');
  }
  const wrapped = new WeakMap<object, object>();
  const wrap = <C extends object>(source: C): C => {
    const held = wrapped.get(source);
    if (held) return held as C;
    const methods = new Map<PropertyKey, unknown>();
    const proxy = new Proxy(source, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value !== 'function') return value;
        if (methods.has(key)) return methods.get(key);
        let forward: unknown;
        if (key === 'unsafe') {
          forward = (...args: unknown[]) => {
            const parameters = args[1], options = args[2];
            const validOptions = options === undefined ||
              options !== null && typeof options === 'object' && !Array.isArray(options);
            // Explicit prepare/simple choices (including inherited or undefined
            // values) stay on the native path. Never interpolate parameters.
            if (typeof args[0] === 'string' && Array.isArray(parameters) &&
                parameters.length > 0 && validOptions &&
                !('prepare' in ((options ?? {}) as object)) &&
                !('simple' in ((options ?? {}) as object))) {
              return value.call(target, args[0], parameters, {
                ...(options as object | undefined), prepare: true,
              });
            }
            return value.apply(target, args);
          };
        } else if (key === 'begin' || key === 'savepoint') {
          forward = (...args: unknown[]) => {
            const at = args.length - 1, callback = args[at];
            if (typeof callback === 'function') {
              args[at] = function(this: unknown, inner: object, ...rest: unknown[]) {
                return callback.call(this, wrap(inner), ...rest);
              };
            }
            return value.apply(target, args);
          };
        } else if (key === 'reserve') {
          forward = (...args: unknown[]) =>
            value.apply(target, args).then((inner: object) => wrap(inner));
        } else {
          return value;
        }
        // Return the original native Query, rather than a Promise/wrapper, so
        // values/raw/execute/cancel and the driver's error semantics survive.
        methods.set(key, forward);
        return forward;
      },
    });
    wrapped.set(source, proxy);
    return proxy;
  };
  return wrap(client);
}

/** This opt-in can never silently change production or an unknown stage. */
export function developmentPreparedQueries(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.WAKA_DB_PREPARED_QUERIES === undefined || env.WAKA_DB_PREPARED_QUERIES === '0') return false;
  if (env.WAKA_DB_PREPARED_QUERIES !== '1' || !['development', 'dev'].includes(env.WAKA_STAGE ?? '')) {
    throw new Error('Invalid development database transport configuration');
  }
  return true;
}

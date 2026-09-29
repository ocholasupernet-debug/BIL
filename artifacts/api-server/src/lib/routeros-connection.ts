import { RouterOSAPI } from "node-routeros";

export class RouterOSConnectionLostError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause || "RouterOS connection closed"));
    this.name = "RouterOSConnectionLostError";
  }
}

/**
 * node-routeros emits post-connect socket timeouts as an EventEmitter "error".
 * Without a listener, Node treats that as an uncaught exception and exits.
 * Race writes against the event too, so callers can return a normal API error
 * instead of leaving an HTTP request open after the router disconnects.
 */
export function guardRouterOSConnection<T extends RouterOSAPI>(connection: T): T {
  let failure: RouterOSConnectionLostError | undefined;
  let rejectConnectionFailure!: (reason?: unknown) => void;
  const connectionFailure = new Promise<never>((_resolve, reject) => {
    rejectConnectionFailure = reject;
  });
  // A disconnect can occur between commands, before a write is racing it.
  void connectionFailure.catch(() => undefined);

  const markDisconnected = (cause: unknown) => {
    if (failure) return;
    failure = cause instanceof RouterOSConnectionLostError
      ? cause
      : new RouterOSConnectionLostError(cause);
    rejectConnectionFailure(failure);
  };

  connection.on("error", markDisconnected);
  connection.on("close", () => markDisconnected(new Error("RouterOS connection closed.")));

  const originalWrite = connection.write.bind(connection);
  connection.write = ((...args: Parameters<RouterOSAPI["write"]>) => {
    if (failure) return Promise.reject(failure);
    return Promise.race([originalWrite(...args), connectionFailure]);
  }) as RouterOSAPI["write"];

  return connection;
}
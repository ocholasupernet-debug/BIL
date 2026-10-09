function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? "";
  } catch {
    return String(error ?? "");
  }
}

export function isRouterApiTransportFailure(error: unknown): boolean {
  return /timed out|timeout|econnrefused|econnreset|ehostunreach|enetunreach|ehostdown|epipe|socket hang up/i
    .test(errorMessage(error));
}

export function formatRouterConnectionError(host: string, error: unknown): string {
  const message = errorMessage(error).trim();
  const raw = message ? ` (raw: ${message})` : "";

  if (/timed out|timeout|etimedout/i.test(message)) {
    return (
      `The VPS received no TCP response from ${host}:8728. A timeout does not prove that the API is disabled or the firewall is blocking it. ` +
      `First confirm the router is connected to its management VPN and that its current tunnel IP is ${host}. ` +
      `If the tunnel is connected at this address, inspect the router input firewall and the API service allowed-address list. ` +
      `Do not add a firewall rule based only on this timeout.${raw}`
    );
  }

  if (/econnrefused|connection refused/i.test(message)) {
    return (
      `The VPS reached ${host}:8728, but the router refused the connection. Check that RouterOS API is enabled and that its allowed-address list includes the management VPN.`
      + raw
    );
  }

  if (/ehostunreach|enetunreach|no route/i.test(message)) {
    return (
      `The VPS has no route to ${host}:8728. Confirm the router's management VPN is connected and that this is its current tunnel IP.`
      + raw
    );
  }

  if (/econnreset|ehostdown|epipe|socket hang up/i.test(message)) {
    return (
      `The TCP connection to ${host}:8728 was reset. Check the router's management VPN stability and current system load before changing API or firewall settings.`
      + raw
    );
  }

  return message || `The VPS could not connect to ${host}:8728. Confirm the management VPN path and router address.`;
}

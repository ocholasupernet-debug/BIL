export function routerApiTransport(value: number | string | null | undefined): {
  port: 8728 | 8729;
  useSSL: boolean;
} {
  const savedPort = Number(value);
  return savedPort === 8729
    ? { port: 8729, useSSL: true }
    : { port: 8728, useSSL: false };
}

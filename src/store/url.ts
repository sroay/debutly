/**
 * A Postgres URL as postgres.js should get it. postgres.js sends query parameters it doesn't
 * know to the server as settings, and the server rejects libpq-only ones such as
 * channel_binding, which Neon's connection strings carry. Dropping it keeps the connection on
 * TLS (sslmode stays), so a connection string can be pasted exactly as the host gives it.
 */
export function postgresUrl(url: string): string {
  const q = url.indexOf("?");
  if (q < 0) return url;
  const params = url
    .slice(q + 1)
    .split("&")
    .filter((p) => p && !/^channel_binding=/i.test(p));
  return params.length ? `${url.slice(0, q)}?${params.join("&")}` : url.slice(0, q);
}

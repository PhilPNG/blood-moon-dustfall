/** Hosted frontends keep invitations on their own origin, even behind an API proxy. */
export function publicJoinOrigin(config: { online?: boolean; joinOrigin?: string }, currentOrigin: string): string {
  return config.online ? currentOrigin : config.joinOrigin || currentOrigin;
}

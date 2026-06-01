// Owns the full browser-side reconnect path shared by the player and editor.
// It restarts the whole page entry with a cache-busting URL parameter so the
// frontend runtime, module graph, and project API/bootstrap data are rebuilt.
const HARD_RECONNECT_QUERY_PARAM = "reconnectAt";

export function isHardReconnectShortcut(event: KeyboardEvent): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "r";
}

export function hardReconnectCurrentPage(options: { beforeReconnect?: () => void; setStatus?: (message: string) => void } = {}): void {
  options.setStatus?.("正在完全重新连接...");
  options.beforeReconnect?.();

  const url = new URL(window.location.href);
  url.searchParams.set(HARD_RECONNECT_QUERY_PARAM, Date.now().toString(36));
  window.location.replace(url.toString());
}

export function consumeHardReconnectRequest(): boolean {
  const url = new URL(window.location.href);
  const requested = url.searchParams.has(HARD_RECONNECT_QUERY_PARAM);
  if (!requested) return false;

  url.searchParams.delete(HARD_RECONNECT_QUERY_PARAM);
  window.history.replaceState(window.history.state, document.title, url.toString());
  return true;
}

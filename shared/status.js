import { onSync } from "./firebase.js";
import { ensureCloud } from "./store.js";

let mounted = false;

export function mountSync() {
  if (mounted || typeof document === "undefined") return;
  mounted = true;
  const el = document.createElement("p");
  el.className = "boki-sync";
  el.setAttribute("role", "status");
  el.hidden = true;
  document.body.appendChild(el);
  onSync((status) => {
    const label = status.state === "synced" ? "Synced" : status.state === "syncing" ? "Syncing" : status.state === "offline" ? "Offline" : "";
    el.hidden = !label;
    el.dataset.state = status.state || "";
    el.textContent = label;
  });
  ensureCloud();
}

mountSync();

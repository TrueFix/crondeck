export interface UIPreferences {
  clock: "12" | "24";
  timezone: "local" | "UTC";
  timestamps: "relative" | "exact";
  density: "comfortable" | "compact";
  weekStart: "sunday" | "monday";
  logFollow: boolean;
}

export const defaultPreferences: UIPreferences = {
  clock: "24", timezone: "local", timestamps: "relative",
  density: "comfortable", weekStart: "sunday", logFollow: true
};
const key = "crondeck.ui";
let current = defaultPreferences;
let loaded = false;
const listeners = new Set<() => void>();

function read(): UIPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return {
      clock: value.clock === "12" ? "12" : "24",
      timezone: value.timezone === "UTC" ? "UTC" : "local",
      timestamps: value.timestamps === "exact" ? "exact" : "relative",
      density: value.density === "compact" ? "compact" : "comfortable",
      weekStart: value.weekStart === "monday" ? "monday" : "sunday",
      logFollow: value.logFollow !== false
    };
  } catch { return defaultPreferences; }
}

export function getPreferences(): UIPreferences {
  if (typeof window === "undefined") return defaultPreferences;
  if (!loaded) { current = read(); loaded = true; }
  return current;
}

export function savePreferences(patch: Partial<UIPreferences>) {
  current = { ...getPreferences(), ...patch };
  try { localStorage.setItem(key, JSON.stringify(current)); } catch { /* Still apply for this tab. */ }
  document.documentElement.dataset.density = current.density;
  listeners.forEach(fn => fn());
}

export function subscribePreferences(fn: () => void) {
  listeners.add(fn);
  const storage = (e: StorageEvent) => {
    if (e.key !== key && e.key !== null) return;
    current = read(); loaded = true;
    document.documentElement.dataset.density = current.density;
    fn();
  };
  window.addEventListener("storage", storage);
  return () => { listeners.delete(fn); window.removeEventListener("storage", storage); };
}

export function displayTimezone() {
  return getPreferences().timezone === "UTC" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone;
}

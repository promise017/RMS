// Login info kept in the browser after signup/login: { access, refresh, user }.
// localStorage can throw (private windows, blocked storage), so every access is guarded.

export function saveSession({ access, refresh, user }) {
  try {
    localStorage.setItem("access", access);
    localStorage.setItem("refresh", refresh);
    localStorage.setItem("user", JSON.stringify(user));
  } catch { /* storage blocked */ }
}

export function getSession() {
  try {
    const access = localStorage.getItem("access");
    const refresh = localStorage.getItem("refresh");
    const user = JSON.parse(localStorage.getItem("user") || "null");
    return access && user ? { access, refresh, user } : null;
  } catch {
    return null;
  }
}

export function saveTokens({ access, refresh }) {
  try {
    if (access) localStorage.setItem("access", access);
    if (refresh) localStorage.setItem("refresh", refresh);
  } catch { /* storage blocked */ }
}

export function updateUser(changes) {
  const session = getSession();
  if (!session) return;
  try {
    localStorage.setItem("user", JSON.stringify({ ...session.user, ...changes }));
  } catch { /* storage blocked */ }
  // Lets the sidebar pick up a new name or building straight away
  window.dispatchEvent(new Event("griha:user"));
}

export function clearSession() {
  try {
    localStorage.removeItem("access");
    localStorage.removeItem("refresh");
    localStorage.removeItem("user");
  } catch { /* storage blocked */ }
}

// Where a logged-in user belongs: secretaries get their workspace,
// residents and guards first need to join a building with its code.
export function homePathFor(user) {
  if (user.role === "secretary") return "/secretary";
  if (!user.building) return "/join";
  return user.role === "resident" ? "/resident" : "/guard";
}

// Read a fetch response that may or may not be JSON.
export async function readJson(res) {
  const raw = await res.text();
  try { return JSON.parse(raw); } catch { return null; }
}

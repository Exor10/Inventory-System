// Auth helpers — used by every page.
// Session lives in sessionStorage (clears when browser tab/window closes).

const auth = (() => {
  const KEY = CONFIG.SESSION_KEY;

  function getSession() {
    try {
      const raw = sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function saveSession(data) {
    sessionStorage.setItem(KEY, JSON.stringify(data));
  }

  function clearSession() {
    sessionStorage.removeItem(KEY);
  }

  // Call on every protected page load. Redirects to login if not authed.
  async function requireAuth(redirectTo = 'index.html') {
    const session = getSession();
    if (!session?.token) {
      window.location.href = redirectTo;
      return null;
    }
    // Quick server-side check
    const result = await api.validateToken();
    if (!result.ok) {
      clearSession();
      window.location.href = redirectTo;
      return null;
    }
    return { ...session, ...result.data };
  }

  // Call on every protected admin page load.
  async function requireAdmin(redirectTo = 'index.html') {
    const user = await requireAuth(redirectTo);
    if (!user) return null;
    if (user.role !== 'admin') {
      window.location.href = redirectTo;
      return null;
    }
    return user;
  }

  async function login(username, pin) {
    const result = await api.login(username, pin);
    if (result.ok) saveSession(result.data);
    return result;
  }

  function logout() {
    clearSession();
    window.location.href = 'index.html';
  }

  function getUser() { return getSession(); }

  function isLoggedIn() { return !!getSession()?.token; }

  return { requireAuth, requireAdmin, login, logout, getUser, isLoggedIn };
})();

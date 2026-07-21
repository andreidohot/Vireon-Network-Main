const ACCESS_KEY = "vireon_admin_access_token";
const REFRESH_KEY = "vireon_admin_refresh_token";

export function readStoredAuth() {
  return {
    accessToken: localStorage.getItem(ACCESS_KEY) ?? "",
    refreshToken: localStorage.getItem(REFRESH_KEY) ?? "",
    user: null
  };
}

export function persistAuth({ accessToken = "", refreshToken = "" }) {
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}

export async function publicApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}

export function createApiClient({ getAuth, setAuth }) {
  async function api(path, options = {}, hasRetried = false) {
    const auth = getAuth();
    if (!auth.accessToken && auth.refreshToken) {
      await refreshAccessToken();
    }

    const nextAuth = getAuth();
    const response = await fetch(path, {
      ...options,
      headers: {
        "Authorization": `Bearer ${nextAuth.accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {})
      }
    });

    if (response.status === 401 && nextAuth.refreshToken && !hasRetried) {
      await refreshAccessToken();
      return api(path, options, true);
    }

    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Request failed.");
    return data;
  }

  async function refreshAccessToken() {
    const result = await publicApi("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: getAuth().refreshToken })
    });
    setAuth(result);
    return result;
  }

  return { api, refreshAccessToken };
}

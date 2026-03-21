const ADMIN_CONFIG = window.CODESENTINEL_CONFIG || {};
const ADMIN_API_BASE_URL = String(ADMIN_CONFIG.API_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");

let adminPollTimer = null;

function adminApiUrl(path) {
  return `${ADMIN_API_BASE_URL}${path}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setAdminStatus(message, state = "") {
  const status = document.getElementById("adminStatusText");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", state === "error");
  status.classList.toggle("is-ready", state === "ready");
}

function setAdminAuthState(authenticated) {
  const loginCard = document.getElementById("adminLoginCard");
  const dashboard = document.getElementById("adminDashboard");
  const logoutBtn = document.getElementById("adminLogoutBtn");
  const liveState = document.getElementById("adminLiveState");

  if (loginCard) loginCard.hidden = authenticated;
  if (dashboard) dashboard.hidden = !authenticated;
  if (logoutBtn) logoutBtn.hidden = !authenticated;
  if (liveState) liveState.textContent = authenticated ? "LIVE" : "LOCKED";
}

function adminFetch(path, options = {}) {
  return fetch(adminApiUrl(path), {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
}

function renderAdminSummary(keys) {
  const total = keys.length;
  const active = keys.filter((key) => key.active).length;
  const bound = keys.filter((key) => key.current_device && key.current_device !== "No active device" && key.current_device !== "Master bypass ready").length;
  const inactive = keys.filter((key) => !key.active).length;

  document.getElementById("adminTotalKeys").textContent = total;
  document.getElementById("adminActiveKeys").textContent = active;
  document.getElementById("adminBoundKeys").textContent = bound;
  document.getElementById("adminInactiveKeys").textContent = inactive;
}

function renderAdminKeys(keys) {
  const grid = document.getElementById("adminKeysGrid");
  if (!grid) return;

  if (!keys.length) {
    grid.innerHTML = `
      <div class="admin-key-card">
        <div class="admin-key-title">No keys found</div>
        <div class="admin-key-mask">Key store is empty.</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = keys.map((key) => {
    const inactiveClass = key.active ? "" : " is-inactive";
    const boundClass = key.current_device && key.current_device !== "No active device" ? " is-bound" : "";
    const canManage = !key.is_master;

    return `
      <div class="admin-key-card${inactiveClass}${boundClass}">
        <div class="admin-key-top">
          <div>
            <div class="admin-key-title">${escapeHtml(key.label)}</div>
            <div class="admin-key-mask">${escapeHtml(key.masked_key)}</div>
          </div>
          <span class="admin-key-status ${key.active ? "is-active" : "is-inactive"}">${escapeHtml(key.status)}</span>
        </div>

        <div class="admin-key-meta">
          <div class="admin-key-meta-item">
            <div class="admin-key-meta-label">Current Device</div>
            <div class="admin-key-meta-value">${escapeHtml(key.current_device)}</div>
          </div>
          <div class="admin-key-meta-item">
            <div class="admin-key-meta-label">Session</div>
            <div class="admin-key-meta-value">${escapeHtml(key.session)}</div>
          </div>
          <div class="admin-key-meta-item">
            <div class="admin-key-meta-label">Last Used</div>
            <div class="admin-key-meta-value">${escapeHtml(key.last_used_time)}</div>
          </div>
          <div class="admin-key-meta-item">
            <div class="admin-key-meta-label">Last IP</div>
            <div class="admin-key-meta-value">${escapeHtml(key.last_ip)}</div>
          </div>
        </div>

        <div class="admin-key-actions">
          <button class="btn-system btn-mini ${key.active ? "btn-ghost" : ""}" type="button"
            onclick="toggleAdminKey('${escapeHtml(key.key)}', ${key.active ? "false" : "true"})"
            ${canManage ? "" : "disabled"}>
            ${key.active ? "Deactivate" : "Activate"}
          </button>
          <button class="btn-system btn-mini btn-ghost admin-action-terminate" type="button"
            onclick="terminateAdminKey('${escapeHtml(key.key)}')"
            ${canManage ? "" : "disabled"}>
            Terminate
          </button>
        </div>
      </div>
    `;
  }).join("");
}

async function refreshAdminKeys() {
  const res = await adminFetch("/admin/keys", { method: "GET" });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Could not load admin keys.");
  }

  renderAdminSummary(data.keys || []);
  renderAdminKeys(data.keys || []);
}

function startAdminPolling() {
  if (adminPollTimer) {
    clearInterval(adminPollTimer);
  }

  adminPollTimer = setInterval(() => {
    refreshAdminKeys().catch(() => {
      setAdminStatus("Lost live sync with the backend admin service.", "error");
    });
  }, 5000);
}

function stopAdminPolling() {
  if (adminPollTimer) {
    clearInterval(adminPollTimer);
    adminPollTimer = null;
  }
}

async function adminLogin() {
  const username = document.getElementById("adminUsername").value.trim();
  const password = document.getElementById("adminPassword").value.trim();

  if (!username || !password) {
    setAdminStatus("Enter both admin username and password.", "error");
    return;
  }

  const res = await adminFetch("/admin/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();

  if (!res.ok) {
    setAdminStatus(data.error || "Admin login failed.", "error");
    return;
  }

  setAdminAuthState(true);
  setAdminStatus(data.message || "Admin session unlocked.", "ready");
  await refreshAdminKeys();
  startAdminPolling();
}

async function adminLogout() {
  await adminFetch("/admin/logout", { method: "POST" });
  stopAdminPolling();
  setAdminAuthState(false);
  setAdminStatus("Admin session cleared.");
}

async function toggleAdminKey(key, active) {
  const res = await adminFetch("/toggle-key", {
    method: "POST",
    body: JSON.stringify({ key, active }),
  });
  const data = await res.json();

  if (!res.ok) {
    setAdminStatus(data.error || "Could not update key state.", "error");
    return;
  }

  setAdminStatus(`Updated ${data.key.label} successfully.`, "ready");
  await refreshAdminKeys();
}

async function terminateAdminKey(key) {
  const res = await adminFetch("/terminate-key", {
    method: "POST",
    body: JSON.stringify({ key }),
  });
  const data = await res.json();

  if (!res.ok) {
    setAdminStatus(data.error || "Could not terminate key session.", "error");
    return;
  }

  setAdminStatus(`Terminated ${data.key.label} session.`, "ready");
  await refreshAdminKeys();
}

async function syncAdminSession() {
  const res = await adminFetch("/admin/session", { method: "GET" });
  const data = await res.json();

  if (!data.authenticated) {
    setAdminAuthState(false);
    setAdminStatus("Enter admin credentials to manage CodeSentinel keys.");
    return;
  }

  setAdminAuthState(true);
  setAdminStatus(`Logged in as ${data.username}.`, "ready");
  await refreshAdminKeys();
  startAdminPolling();
}

document.getElementById("adminLoginBtn").addEventListener("click", () => {
  adminLogin().catch((error) => setAdminStatus(error.message || "Admin login failed.", "error"));
});

document.getElementById("adminLogoutBtn").addEventListener("click", () => {
  adminLogout().catch((error) => setAdminStatus(error.message || "Admin logout failed.", "error"));
});

document.getElementById("adminPassword").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    adminLogin().catch((error) => setAdminStatus(error.message || "Admin login failed.", "error"));
  }
});

syncAdminSession().catch((error) => {
  setAdminAuthState(false);
  setAdminStatus(error.message || "Admin service not reachable.", "error");
});

window.toggleAdminKey = toggleAdminKey;
window.terminateAdminKey = terminateAdminKey;

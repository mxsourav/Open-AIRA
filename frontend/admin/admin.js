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
    const boundClass = key.current_device && key.current_device !== "No active device" && key.current_device !== "Master bypass ready" ? " is-bound" : "";
    const masterClass = key.is_master ? " is-master" : "";
    const usageLabel = key.last_used_time === "Never used" ? "Unused key" : "Used key";
    const canManage = !key.is_master;
    const maskedKey = key.is_master ? "***********" : key.masked_key;

    return `
      <div class="admin-key-card${inactiveClass}${boundClass}${masterClass}">
        <div class="admin-key-top">
          <div>
            <div class="admin-key-title">${escapeHtml(key.label)}</div>
            <div class="admin-key-mask">${escapeHtml(maskedKey)}</div>
          </div>
          <div class="admin-key-top-actions">
            <span class="admin-key-status ${key.active ? "is-active" : "is-inactive"}">${escapeHtml(key.status)}</span>
            <button class="btn-system btn-mini btn-ghost admin-action-copy" type="button"
              onclick="copyAdminKey('${escapeHtml(key.key)}', '${escapeHtml(key.label)}')">
              Copy
            </button>
          </div>
        </div>

        <div class="admin-key-flags">
          <span class="admin-key-flag">${escapeHtml(usageLabel)}</span>
          <span class="admin-key-flag">${escapeHtml(key.session)}</span>
        </div>

        <div class="admin-key-meta">
          <div class="admin-key-meta-item">
            <div class="admin-key-meta-label">Current Device</div>
            <div class="admin-key-meta-value">${escapeHtml(key.current_device)}</div>
          </div>
          <div class="admin-key-meta-item">
            <div class="admin-key-meta-label">Last Used</div>
            <div class="admin-key-meta-value">${escapeHtml(key.last_used_time)}</div>
          </div>
          <div class="admin-key-meta-item">
            <div class="admin-key-meta-label">Last IP</div>
            <div class="admin-key-meta-value">${escapeHtml(key.last_ip)}</div>
          </div>
          <div class="admin-key-meta-item">
            <div class="admin-key-meta-label">Mode</div>
            <div class="admin-key-meta-value">${key.is_master ? "Master bypass" : "Invite key"}</div>
          </div>
        </div>

        <div class="admin-key-actions">
          ${canManage ? `
            <button class="btn-system btn-mini ${key.active ? "btn-ghost" : ""}" type="button"
              onclick="toggleAdminKey('${escapeHtml(key.key)}', ${key.active ? "false" : "true"})">
              ${key.active ? "Deactivate" : "Activate"}
            </button>
            <button class="btn-system btn-mini btn-ghost admin-action-terminate" type="button"
              onclick="terminateAdminKey('${escapeHtml(key.key)}')">
              Terminate
            </button>
          ` : `
            <button class="btn-system btn-mini btn-ghost admin-action-edit" type="button"
              onclick="focusMasterEditor()">
              Edit
            </button>
            <div class="admin-master-note">Use the master-key editor beside this list.</div>
          `}
        </div>
      </div>
    `;
  }).join("");
}

function renderAdminControls(overview) {
  const master = overview.master_key || null;
  const adminUser = overview.admin_user || null;

  document.getElementById("adminMasterMasked").textContent = master ? "***********" : "Unavailable";
  document.getElementById("adminMasterMeta").textContent = master
    ? `${master.current_device} • ${master.last_used_time}`
    : "Master key status is unavailable.";

  document.getElementById("adminCurrentUsername").textContent = adminUser ? adminUser.username : "Unavailable";
  document.getElementById("adminAdminUpdatedAt").textContent = adminUser
    ? `Last updated: ${adminUser.updated_at}`
    : "Admin login details unavailable.";

  const usernameInput = document.getElementById("adminNewUsername");
  if (usernameInput && adminUser && !usernameInput.value.trim()) {
    usernameInput.value = adminUser.username;
  }
}

async function refreshAdminOverview() {
  const res = await adminFetch("/admin/overview", { method: "GET" });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Could not load admin overview.");
  }

  const keys = Array.isArray(data.keys) ? data.keys : [];
  renderAdminSummary(keys);
  renderAdminKeys(keys);
  renderAdminControls(data);
}

function startAdminPolling() {
  if (adminPollTimer) {
    clearInterval(adminPollTimer);
  }

  adminPollTimer = setInterval(() => {
    refreshAdminOverview().catch(() => {
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
  await refreshAdminOverview();
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
  await refreshAdminOverview();
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
  await refreshAdminOverview();
}

async function copyAdminKey(key, label) {
  try {
    await navigator.clipboard.writeText(key);
    setAdminStatus(`Copied ${label} key to clipboard.`, "ready");
  } catch (error) {
    setAdminStatus("Could not copy the key from this browser.", "error");
  }
}

function focusMasterEditor() {
  const input = document.getElementById("adminMasterKeyInput");
  if (!input) return;
  input.scrollIntoView({ behavior: "smooth", block: "center" });
  input.focus();
}

async function updateAdminMasterKey() {
  const input = document.getElementById("adminMasterKeyInput");
  const newKey = input.value.trim();

  if (!newKey) {
    setAdminStatus("Enter a new master key first.", "error");
    return;
  }

  const res = await adminFetch("/admin/master-key", {
    method: "POST",
    body: JSON.stringify({ new_key: newKey }),
  });
  const data = await res.json();

  if (!res.ok) {
    setAdminStatus(data.error || "Could not update the master key.", "error");
    return;
  }

  input.value = "";
  setAdminStatus(data.message || "Master key updated.", "ready");
  await refreshAdminOverview();
}

async function updateAdminCredentials() {
  const newUsername = document.getElementById("adminNewUsername").value.trim();
  const currentPassword = document.getElementById("adminCurrentPassword").value;
  const newPassword = document.getElementById("adminNewPassword").value;
  const confirmPassword = document.getElementById("adminConfirmPassword").value;

  if (!currentPassword.trim()) {
    setAdminStatus("Current admin password is required.", "error");
    return;
  }

  if (newPassword || confirmPassword) {
    if (newPassword !== confirmPassword) {
      setAdminStatus("New admin password and confirm password do not match.", "error");
      return;
    }
  }

  const res = await adminFetch("/admin/credentials", {
    method: "POST",
    body: JSON.stringify({
      current_password: currentPassword,
      new_username: newUsername,
      new_password: newPassword,
    }),
  });
  const data = await res.json();

  if (!res.ok) {
    setAdminStatus(data.error || "Could not update admin login details.", "error");
    return;
  }

  document.getElementById("adminCurrentPassword").value = "";
  document.getElementById("adminNewPassword").value = "";
  document.getElementById("adminConfirmPassword").value = "";
  setAdminStatus(data.message || "Admin login details updated.", "ready");
  await refreshAdminOverview();
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
  await refreshAdminOverview();
  startAdminPolling();
}

document.getElementById("adminLoginBtn").addEventListener("click", () => {
  adminLogin().catch((error) => setAdminStatus(error.message || "Admin login failed.", "error"));
});

document.getElementById("adminLogoutBtn").addEventListener("click", () => {
  adminLogout().catch((error) => setAdminStatus(error.message || "Admin logout failed.", "error"));
});

document.getElementById("adminSaveMasterBtn").addEventListener("click", () => {
  updateAdminMasterKey().catch((error) => setAdminStatus(error.message || "Could not update the master key.", "error"));
});

document.getElementById("adminSaveCredentialsBtn").addEventListener("click", () => {
  updateAdminCredentials().catch((error) => setAdminStatus(error.message || "Could not update admin login details.", "error"));
});

document.getElementById("adminPassword").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    adminLogin().catch((error) => setAdminStatus(error.message || "Admin login failed.", "error"));
  }
});

document.getElementById("adminMasterKeyInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    updateAdminMasterKey().catch((error) => setAdminStatus(error.message || "Could not update the master key.", "error"));
  }
});

document.getElementById("adminConfirmPassword").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    updateAdminCredentials().catch((error) => setAdminStatus(error.message || "Could not update admin login details.", "error"));
  }
});

syncAdminSession().catch((error) => {
  setAdminAuthState(false);
  setAdminStatus(error.message || "Admin service not reachable.", "error");
});

window.toggleAdminKey = toggleAdminKey;
window.terminateAdminKey = terminateAdminKey;
window.copyAdminKey = copyAdminKey;
window.focusMasterEditor = focusMasterEditor;

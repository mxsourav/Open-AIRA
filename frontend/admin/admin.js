const ADMIN_CONFIG = window.CODESENTINEL_CONFIG || {};
const ADMIN_API_BASE_URL = String(ADMIN_CONFIG.API_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
const ADMIN_TOKEN_STORAGE_KEY = "codesentinel_admin_token";

const ADMIN_PROVIDER_META = {
  gemini: { label: "Gemini", logo: "../assets/providers/gemini-color.svg" },
  openai: { label: "OpenAI", logo: "../assets/providers/openai-color.svg" },
  xai: { label: "Grok", logo: "../assets/providers/grok-color.svg" },
  claude: { label: "Claude", logo: "../assets/providers/claude-color.svg" },
  deepseek: { label: "DeepSeek", logo: "../assets/providers/deepseek-color.svg" },
};

let adminPollTimer = null;
let adminStatusAnimationToken = 0;
let adminStatusTimeouts = [];

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

function getProviderMeta(providerId) {
  return ADMIN_PROVIDER_META[String(providerId || "").trim().toLowerCase()] || null;
}

function getAdminIcon(name) {
  if (name === "copy") {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="9" y="9" width="10" height="10" rx="2"></rect>
        <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"></path>
      </svg>
    `;
  }

  if (name === "power") {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v8"></path>
        <path d="M6.3 6.3a8 8 0 1 0 11.4 0"></path>
      </svg>
    `;
  }

  if (name === "terminate") {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 6 6 18"></path>
        <path d="m6 6 12 12"></path>
      </svg>
    `;
  }

  if (name === "edit") {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 20h9"></path>
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
      </svg>
    `;
  }

  return "";
}

function clearAdminStatusAnimation() {
  adminStatusAnimationToken += 1;
  adminStatusTimeouts.forEach((timer) => clearTimeout(timer));
  adminStatusTimeouts = [];
}

function queueAdminStatusTimeout(callback, delay) {
  const timer = setTimeout(callback, delay);
  adminStatusTimeouts.push(timer);
}

function setAdminLiveState(state) {
  const chip = document.querySelector(".admin-live-chip");
  const liveState = document.getElementById("adminLiveState");
  if (!chip || !liveState) return;

  chip.classList.remove("is-live", "is-locked", "is-updating");

  if (state === "live") {
    liveState.textContent = "LIVE";
    chip.classList.add("is-live");
    return;
  }

  if (state === "updating") {
    liveState.textContent = "UPDATING";
    chip.classList.add("is-updating");
    return;
  }

  liveState.textContent = "LOCKED";
  chip.classList.add("is-locked");
}

function setAdminStatus(message = "", state = "", options = {}) {
  const status = document.getElementById("adminStatusText");
  if (!status) return;

  clearAdminStatusAnimation();
  status.classList.remove("is-error", "is-ready", "is-welcome", "is-fading");

  if (!message) {
    status.textContent = "";
    return;
  }

  if (options.animate) {
    const token = adminStatusAnimationToken;
    const text = String(message);
    let cursor = 0;

    status.classList.add("is-welcome");
    status.textContent = "";

    const typeIn = () => {
      if (token !== adminStatusAnimationToken) return;
      cursor += 1;
      status.textContent = text.slice(0, cursor);

      if (cursor < text.length) {
        queueAdminStatusTimeout(typeIn, options.typeSpeed || 34);
        return;
      }

      queueAdminStatusTimeout(() => {
        if (token !== adminStatusAnimationToken) return;

        const typeOut = () => {
          if (token !== adminStatusAnimationToken) return;
          cursor -= 1;
          status.classList.toggle("is-fading", cursor <= Math.ceil(text.length / 2));
          status.textContent = text.slice(0, Math.max(cursor, 0));

          if (cursor > 0) {
            queueAdminStatusTimeout(typeOut, options.deleteSpeed || 22);
            return;
          }

          status.classList.remove("is-welcome", "is-fading");
          status.textContent = "";
        };

        typeOut();
      }, options.holdMs || 4000);

      return;
    };

    typeIn();
    return;
  }

  status.textContent = message;
  status.classList.toggle("is-error", state === "error");
  status.classList.toggle("is-ready", state === "ready");
}

function setAdminAuthState(authenticated) {
  const loginCard = document.getElementById("adminLoginCard");
  const dashboard = document.getElementById("adminDashboard");
  const logoutBtn = document.getElementById("adminLogoutBtn");

  if (loginCard) loginCard.hidden = authenticated;
  if (dashboard) dashboard.hidden = !authenticated;
  if (logoutBtn) logoutBtn.hidden = !authenticated;
  setAdminLiveState(authenticated ? "live" : "locked");
}

function adminFetch(path, options = {}) {
  const adminToken = localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || "";
  return fetch(adminApiUrl(path), {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { "X-CodeSentinel-Admin": adminToken } : {}),
      ...(options.headers || {})
    },
    ...options,
  });
}

function renderAdminSummary(keys) {
  const inviteKeys = keys.filter((key) => !key.is_master);
  const total = inviteKeys.length;
  const active = inviteKeys.filter((key) => key.active).length;
  const bound = inviteKeys.filter((key) => key.current_device && key.current_device !== "No active device").length;
  const inactive = inviteKeys.filter((key) => !key.active).length;

  document.getElementById("adminTotalKeys").textContent = total;
  document.getElementById("adminActiveKeys").textContent = active;
  document.getElementById("adminBoundKeys").textContent = bound;
  document.getElementById("adminInactiveKeys").textContent = inactive;
}

function renderProviderButton(key, index) {
  const provider = getProviderMeta(key.provider);
  if (!provider) {
    return `<button class="admin-provider-button is-empty" type="button" disabled title="No AI provider used yet">--</button>`;
  }

  return `
    <button class="admin-provider-button" type="button"
      onclick="toggleProviderDetails(${index})"
      title="Show ${escapeHtml(provider.label)} and IP details">
      <img src="${provider.logo}" alt="${escapeHtml(provider.label)}" loading="lazy" />
    </button>
  `;
}

function renderAdminKeys(keys) {
  const grid = document.getElementById("adminKeysGrid");
  if (!grid) return;

  const inviteKeys = keys.filter((key) => !key.is_master);

  if (!inviteKeys.length) {
    grid.innerHTML = `
      <div class="admin-key-card">
        <div class="admin-key-title">No beta keys found</div>
        <div class="admin-key-mask">The invite inventory is empty.</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = inviteKeys.map((key, index) => {
    const inactiveClass = key.active ? "" : " is-inactive";
    const boundClass = key.current_device && key.current_device !== "No active device" ? " is-bound" : "";
    const providerButton = renderProviderButton(key, index);

    return `
      <div class="admin-key-card${inactiveClass}${boundClass}">
        <div class="admin-key-top">
          <div class="admin-key-id">
            <div class="admin-key-rank">${escapeHtml(key.label)}</div>
            <div class="admin-key-mask">${escapeHtml(key.masked_key)}</div>
          </div>
          <div class="admin-key-toolbar">
            <button class="admin-icon-button admin-action-copy" type="button"
              onclick="copyAdminKey('${escapeHtml(key.key)}', '${escapeHtml(key.label)}')"
              title="Copy ${escapeHtml(key.label)} key">
              ${getAdminIcon("copy")}
            </button>
            <span class="admin-state-dot ${key.active ? "is-active" : "is-inactive"}" title="${escapeHtml(key.status)}"></span>
            <button class="admin-icon-button ${key.active ? "is-live" : "is-off"}" type="button"
              onclick="toggleAdminKey('${escapeHtml(key.key)}', ${key.active ? "false" : "true"})"
              title="${key.active ? "Deactivate" : "Activate"} ${escapeHtml(key.label)}">
              ${getAdminIcon("power")}
            </button>
            <button class="admin-icon-button admin-action-terminate" type="button"
              onclick="terminateAdminKey('${escapeHtml(key.key)}')"
              title="Terminate ${escapeHtml(key.label)} session">
              ${getAdminIcon("terminate")}
            </button>
          </div>
        </div>

        <div class="admin-key-compact-grid">
          <div class="admin-mini-detail">
            <span>Device</span>
            <b>${escapeHtml(key.current_device)}</b>
          </div>
          <div class="admin-mini-detail">
            <span>First Use</span>
            <b>${escapeHtml(key.first_used_time)}</b>
          </div>
          <div class="admin-mini-detail">
            <span>Last Use</span>
            <b>${escapeHtml(key.last_used_time)}</b>
          </div>
          <div class="admin-mini-detail admin-provider-mini">
            <span>AI / IP</span>
            ${providerButton}
          </div>
        </div>

        <div class="admin-provider-details" id="adminProviderDetails-${index}" hidden>
          <div class="admin-provider-detail-row">
            <span>Provider</span>
            <b>${escapeHtml(key.provider_label || "No provider yet")}</b>
          </div>
          <div class="admin-provider-detail-row">
            <span>Last IP</span>
            <b>${escapeHtml(key.last_ip)}</b>
          </div>
          <div class="admin-provider-detail-row">
            <span>Session</span>
            <b>${escapeHtml(key.session)}</b>
          </div>
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

function toggleAdminEditor(panelId, buttonId, showLabel, hideLabel) {
  const panel = document.getElementById(panelId);
  const button = document.getElementById(buttonId);
  if (!panel || !button) return;

  const willOpen = panel.hidden;
  panel.hidden = !willOpen ? true : false;
  button.textContent = willOpen ? hideLabel : showLabel;
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
  if (data.admin_token) {
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, data.admin_token);
  }
  await refreshAdminOverview();
  startAdminPolling();
  setAdminStatus(`Welcome back, ${data.username || username}.`, "ready", { animate: true, holdMs: 4000 });
}

async function adminLogout() {
  await adminFetch("/admin/logout", { method: "POST" });
  localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  stopAdminPolling();
  setAdminAuthState(false);
  setAdminStatus("");
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

function toggleProviderDetails(index) {
  const target = document.getElementById(`adminProviderDetails-${index}`);
  if (!target) return;

  document.querySelectorAll(".admin-provider-details").forEach((panel) => {
    if (panel !== target) {
      panel.hidden = true;
    }
  });

  target.hidden = !target.hidden;
}

async function updateAdminMasterKey() {
  const input = document.getElementById("adminMasterKeyInput");
  const newKey = input.value.trim();

  if (!newKey) {
    setAdminStatus("Enter a new master key first.", "error");
    return;
  }

  setAdminLiveState("updating");

  const res = await adminFetch("/admin/master-key", {
    method: "POST",
    body: JSON.stringify({ new_key: newKey }),
  });
  const data = await res.json();

  if (!res.ok) {
    setAdminLiveState("live");
    setAdminStatus(data.error || "Could not update the master key.", "error");
    return;
  }

  input.value = "";
  setAdminLiveState("live");
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

  setAdminLiveState("updating");

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
    setAdminLiveState("live");
    setAdminStatus(data.error || "Could not update admin login details.", "error");
    return;
  }

  document.getElementById("adminCurrentPassword").value = "";
  document.getElementById("adminNewPassword").value = "";
  document.getElementById("adminConfirmPassword").value = "";
  setAdminLiveState("live");
  setAdminStatus(data.message || "Admin login details updated.", "ready");
  await refreshAdminOverview();
}

async function syncAdminSession() {
  const res = await adminFetch("/admin/session", { method: "GET" });
  const data = await res.json();

  if (!data.authenticated) {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    setAdminAuthState(false);
    setAdminStatus("");
    return;
  }

  setAdminAuthState(true);
  setAdminStatus("");
  await refreshAdminOverview();
  startAdminPolling();
}

document.getElementById("adminLoginForm").addEventListener("submit", (event) => {
  event.preventDefault();
  adminLogin().catch((error) => setAdminStatus(error.message || "Admin login failed.", "error"));
});

document.getElementById("adminLogoutBtn").addEventListener("click", () => {
  adminLogout().catch((error) => setAdminStatus(error.message || "Admin logout failed.", "error"));
});

document.getElementById("adminMasterForm").addEventListener("submit", (event) => {
  event.preventDefault();
  updateAdminMasterKey().catch((error) => setAdminStatus(error.message || "Could not update the master key.", "error"));
});

document.getElementById("adminCredentialsForm").addEventListener("submit", (event) => {
  event.preventDefault();
  updateAdminCredentials().catch((error) => setAdminStatus(error.message || "Could not update admin login details.", "error"));
});

document.getElementById("toggleMasterEditorBtn").addEventListener("click", () => {
  toggleAdminEditor(
    "adminMasterEditor",
    "toggleMasterEditorBtn",
    "Show Master Key Editor",
    "Hide Master Key Editor",
  );
});

document.getElementById("toggleCredentialsEditorBtn").addEventListener("click", () => {
  toggleAdminEditor(
    "adminCredentialsEditor",
    "toggleCredentialsEditorBtn",
    "Show Admin Login Editor",
    "Hide Admin Login Editor",
  );
});

syncAdminSession().catch((error) => {
  setAdminAuthState(false);
  setAdminStatus(error.message || "Admin service not reachable.", "error");
});

window.toggleAdminKey = toggleAdminKey;
window.terminateAdminKey = terminateAdminKey;
window.copyAdminKey = copyAdminKey;
window.focusMasterEditor = focusMasterEditor;
window.toggleProviderDetails = toggleProviderDetails;

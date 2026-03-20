// ===== TYPEWRITER =====
function initTypewriter() {
  const target = document.getElementById("status-text");
  const phrases = [
    "System Ready",
    "Debug Coach Active",
    "Fix Workflow Online",
    "Hints Standing By",
    "Analyzing Logic",
    "Training Debug Instincts",
    "Ready For Your Bug",
  ];

  let i = 0;
  let j = 0;
  let isDeleting = false;
  let speed = 80;

  function cycle() {
    const fullText = phrases[i];

    if (isDeleting) {
      target.textContent = fullText.substring(0, j - 1);
      j--;
      speed = 40;
    } else {
      target.textContent = fullText.substring(0, j + 1);
      j++;
      speed = 80;
    }

    if (!isDeleting && j === fullText.length) {
      isDeleting = true;
      speed = 2000;
    } else if (isDeleting && j === 0) {
      isDeleting = false;
      i = (i + 1) % phrases.length;
      speed = 500;
    }

    setTimeout(cycle, speed);
  }

  cycle();
}

// ===== THEME =====
function syncHeroLogo() {
  const html = document.documentElement;
  const heroLogo = document.getElementById("heroLogo");
  if (!heroLogo) return;

  const theme = html.getAttribute("data-theme") || "dark";
  heroLogo.src = theme === "light" ? "assets/logo_white.png" : "assets/logo_black.png";
}

document.getElementById("themeBtn").onclick = () => {
  const html = document.documentElement;
  const theme = html.getAttribute("data-theme");
  html.setAttribute("data-theme", theme === "dark" ? "light" : "dark");
  syncHeroLogo();
};

// ===== STATE =====
let mode = "debug";
let debugState = null;
let apiReady = false;
let betaAccessReady = false;
let betaAccessMeta = null;
let advancedStatsVisible = false;
let debugMode = "beginner";
let apiProvider = "gemini";
let apiStatusTimer = null;

const DONE_MESSAGE = "Yoo Thats My Boy You Did It";
const FOUND_MESSAGE = "Good Job you found the bug now try to debug it.";

const fixState = {
  fixedCode: "",
  changeLog: []
};

const DEBUG_MODE_CONTENT = {
  beginner: {
    index: 0,
    color: "#00ff88",
    allowed: [
      "Breaks problem into small steps",
      "Asks guiding questions",
      "Explains mistakes clearly",
      "Encourages user thinking",
    ],
    restricted: [
      "No direct final answer",
      "No instant full code fix",
      "No advanced optimization",
    ],
    bestFor: [
      "First-time debugging practice",
      "Learning syntax and logic basics",
      "Building confidence before harder bugs",
    ],
  },
  intermediate: {
    index: 1,
    color: "#ffc857",
    allowed: [
      "Gives directional hints",
      "Highlights key problem areas",
      "Provides partial reasoning",
      "Expects user input",
    ],
    restricted: [
      "No full step-by-step guidance",
      "No immediate full solution",
      "Limited explanation depth",
    ],
    bestFor: [
      "Testing your own reasoning speed",
      "Spotting bug regions with less help",
      "Practicing semi-independent debugging",
    ],
  },
  pro: {
    index: 2,
    color: "#ff2d37",
    allowed: [
      "Gives short observations",
      "Points out critical issues only",
      "Mimics real debugging style",
      "Minimal interaction",
    ],
    restricted: [
      "No guidance",
      "No explanation unless requested",
      "No beginner-level help",
    ],
    bestFor: [
      "Fast triage on real-looking bugs",
      "Checking instincts under pressure",
      "Minimal coaching, maximum signal",
    ],
  },
};

const API_PROVIDER_OPTIONS = {
  gemini: {
    label: "Gemini",
    badge: "G",
    accent: "#173a74",
    hint: "Google Gemini",
    logo: "assets/providers/gemini-color.svg",
    keyUrl: "https://aistudio.google.com/apikey"
  },
  openai: {
    label: "OpenAI",
    badge: "O",
    accent: "#74aa9c",
    hint: "OpenAI Platform",
    logo: "assets/providers/openai-color.svg",
    keyUrl: "https://platform.openai.com/api-keys"
  },
  xai: {
    label: "Grok",
    badge: "GX",
    accent: "#d6e0f7",
    hint: "xAI Grok",
    logo: "assets/providers/grok-color.svg",
    keyUrl: "https://console.x.ai/team/default/api-keys"
  },
  claude: {
    label: "Claude",
    badge: "CL",
    accent: "#f28b54",
    hint: "Anthropic Claude",
    logo: "assets/providers/claude-color.svg",
    keyUrl: "https://console.anthropic.com/settings/keys"
  },
  deepseek: {
    label: "DeepSeek",
    badge: "DS",
    accent: "#4d6bfe",
    hint: "DeepSeek API",
    logo: "assets/providers/deepseek-color.svg",
    keyUrl: "https://platform.deepseek.com/api_keys"
  }
};

const statsState = {
  runs: 0,
  thoughts: 0,
  hints: 0,
  wrongTurns: 0,
  bugReads: 0,
  giveUps: 0,
  hintRuns: 0,
  solvedRuns: 0,
  totalSolveSeconds: 0,
  firstTryWins: 0,
  independentSolveStreak: 0,
  progress: 0,
  bestProgress: 0,
  note: "Start a debug run and the tracker will wake up.",
  lastDelta: 0,
  activeRun: null,
};

const THOUGHT_INPUT_MIN_HEIGHT = 42;
const DEBUG_THOUGHT_INPUT_MAX_LINES = 10;
const DEBUG_THOUGHT_INPUT_MAX_LINES_EXPANDED = 12;
const FIX_THOUGHT_INPUT_MAX_LINES = 12;
const APP_CONFIG = window.CODESENTINEL_CONFIG || {};
const API_BASE_URL = String(APP_CONFIG.API_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
const BETA_ACCESS_STORAGE_KEY = "codesentinel_beta_access_key";
const BETA_CLIENT_ID_STORAGE_KEY = "codesentinel_beta_client_id";
const API_KEY_STORAGE_KEY = "codesentinel_user_api_key";
const API_PROVIDER_STORAGE_KEY = "codesentinel_api_provider";
const RELEASE_TIMESTAMP = "2026-03-21T02:32:51+05:30";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getProviderStatusClass(provider = apiProvider) {
  const normalized = normalizeProvider(provider);
  if (normalized === "gemini") return "api-provider-name-gemini";
  if (normalized === "openai") return "api-provider-name-openai";
  if (normalized === "xai") return "api-provider-name-xai";
  if (normalized === "claude") return "api-provider-name-claude";
  if (normalized === "deepseek") return "api-provider-name-deepseek";
  return "";
}

function formatApiStatusMessage(message, provider = apiProvider) {
  const providerLabel = getProviderLabel(provider);
  const safeMessage = escapeHtml(message);
  const safeLabel = escapeHtml(providerLabel);
  const providerClass = getProviderStatusClass(provider);

  if (!safeMessage.includes(safeLabel) || !providerClass) {
    return safeMessage;
  }

  const styledLabel = `<span class="api-provider-status-name ${providerClass}">${safeLabel}</span>`;
  return safeMessage.split(safeLabel).join(styledLabel);
}

function formatElapsedTime(ms) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s passed`;
}

function startReleaseTimer() {
  const yearEl = document.getElementById("yearNow");
  const buildStampEl = document.getElementById("buildStamp");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
  if (!buildStampEl) return;

  const releaseTime = new Date(RELEASE_TIMESTAMP).getTime();
  if (Number.isNaN(releaseTime)) {
    buildStampEl.textContent = "release time unavailable";
    return;
  }

  const updateTimer = () => {
    buildStampEl.textContent = formatElapsedTime(Date.now() - releaseTime);
  };

  updateTimer();
  window.setInterval(updateTimer, 1000);
}

function normalizeProvider(value) {
  return API_PROVIDER_OPTIONS[value] ? value : "gemini";
}

function getProviderMeta(provider = apiProvider) {
  return API_PROVIDER_OPTIONS[normalizeProvider(provider)] || API_PROVIDER_OPTIONS.gemini;
}

function getProviderLabel(provider = apiProvider) {
  return getProviderMeta(provider).label;
}

function updateApiKeyPlaceholder() {
  const input = document.getElementById("apiKeyInput");
  if (!input) return;
  input.placeholder = `Paste your ${getProviderLabel()} API key here`;
}

function renderApiAccessLinks() {
  const list = document.getElementById("apiAccessLinks");
  if (!list) return;

  list.innerHTML = Object.entries(API_PROVIDER_OPTIONS)
    .map(([providerId, details]) => `
      <a
        class="api-access-link${providerId === apiProvider ? " is-active" : ""}"
        href="${escapeHtml(details.keyUrl || "#")}"
        target="_blank"
        rel="noopener noreferrer"
        data-provider="${providerId}"
        style="--provider-accent:${details.accent}"
      >
        <span class="api-access-mark">
          <img
            class="api-access-logo"
            src="${escapeHtml(details.logo)}"
            alt="${escapeHtml(details.label)} logo"
            loading="lazy"
            decoding="async"
            onerror="this.style.display='none'; this.parentElement.querySelector('.api-access-badge').style.display='inline-flex';"
          />
          <span class="api-access-badge">${escapeHtml(details.badge)}</span>
        </span>
        <span class="api-access-name">Get ${escapeHtml(details.label)} API Key</span>
      </a>
    `)
    .join("");
}

function renderProviderSelector() {
  const grid = document.getElementById("apiProviderGrid");
  if (!grid) return;

  grid.innerHTML = Object.entries(API_PROVIDER_OPTIONS)
    .map(([providerId, details]) => `
      <button
        class="api-provider-option${providerId === apiProvider ? " is-active" : ""}"
        type="button"
        data-provider="${providerId}"
        data-tooltip="${escapeHtml(details.hint)}"
        style="--provider-accent:${details.accent}"
      >
        <span class="api-provider-mark">
          <img
            class="api-provider-logo"
            src="${escapeHtml(details.logo)}"
            alt="${escapeHtml(details.label)} logo"
            loading="lazy"
            decoding="async"
            onerror="this.style.display='none'; this.parentElement.querySelector('.api-provider-badge').style.display='inline-flex';"
          />
          <span class="api-provider-badge">${escapeHtml(details.badge)}</span>
        </span>
        <span class="api-provider-name">${escapeHtml(details.label)}</span>
        <span class="api-provider-tooltip">${escapeHtml(details.hint)}</span>
      </button>
    `)
    .join("");

  updateApiKeyPlaceholder();
  renderApiAccessLinks();
}

function setProvider(nextProvider) {
  const normalized = normalizeProvider(nextProvider);
  const previous = apiProvider;
  apiProvider = normalized;
  sessionStorage.setItem(API_PROVIDER_STORAGE_KEY, normalized);
  renderProviderSelector();

  if (apiReady && previous !== normalized) {
    handleApiKeyFailure(`Provider changed to ${getProviderLabel(normalized)}. Submit a new ${getProviderLabel(normalized)} API key.`);
    document.getElementById("apiKeyInput").value = "";
  } else if (!apiReady) {
    setApiGate(false, `Choose ${getProviderLabel(normalized)} and submit your API key to start.`);
  }
}

const CODE_KEYWORDS = new Set([
  "and", "as", "auto", "break", "case", "catch", "char", "class", "const", "continue",
  "def", "default", "define", "do", "double", "elif", "else", "enum", "except", "false",
  "finally", "float", "for", "from", "if", "import", "include", "inline", "int", "long",
  "main", "namespace", "new", "none", "null", "pass", "private", "protected", "public",
  "return", "short", "signed", "sizeof", "static", "struct", "switch", "template", "this",
  "throw", "true", "try", "typedef", "union", "unsigned", "using", "void", "volatile",
  "while"
]);

function classifyToken(token) {
  const trimmed = token.trim();

  if (!trimmed) return escapeHtml(token);
  if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*")) {
    return `<span class="code-comment">${escapeHtml(token)}</span>`;
  }
  if (trimmed.startsWith("\"") || trimmed.startsWith("'") || trimmed.startsWith("`")) {
    return `<span class="code-string">${escapeHtml(token)}</span>`;
  }
  if (/^\d/.test(trimmed)) {
    return `<span class="code-number">${escapeHtml(token)}</span>`;
  }
  if (CODE_KEYWORDS.has(trimmed.toLowerCase())) {
    return `<span class="code-keyword">${escapeHtml(token)}</span>`;
  }
  if (/^[A-Za-z_]\w*$/.test(trimmed)) {
    return `<span class="code-function">${escapeHtml(token)}</span>`;
  }

  return escapeHtml(token);
}

function highlightLine(line) {
  if (/^\s*#\s*(include|define|ifdef|ifndef|endif|pragma)\b/.test(line)) {
    return `<span class="code-preprocessor">${escapeHtml(line)}</span>`;
  }

  const tokenRegex = /(\/\*[\s\S]*?\*\/|\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b(?:and|as|auto|break|case|catch|char|class|const|continue|def|default|define|do|double|elif|else|enum|except|False|false|finally|float|for|from|if|import|include|inline|int|long|main|namespace|new|None|none|null|pass|private|protected|public|return|short|signed|sizeof|static|struct|switch|template|this|throw|True|true|try|typedef|union|unsigned|using|void|volatile|while)\b|[A-Za-z_]\w*(?=\s*\())/g;
  let cursor = 0;
  let html = "";

  for (const match of line.matchAll(tokenRegex)) {
    const index = match.index ?? 0;
    const token = match[0];
    html += escapeHtml(line.slice(cursor, index));
    html += classifyToken(token);
    cursor = index + token.length;
  }

  html += escapeHtml(line.slice(cursor));
  return html;
}

function highlightCode(code) {
  const source = code || "// fixed code will appear here...";
  return source
    .split("\n")
    .map((line) => highlightLine(line))
    .join("\n");
}

function getThoughtInputMaxLines() {
  if (mode === "fix") {
    return FIX_THOUGHT_INPUT_MAX_LINES;
  }

  if (mode === "debug" && !advancedStatsVisible) {
    return DEBUG_THOUGHT_INPUT_MAX_LINES_EXPANDED;
  }

  return DEBUG_THOUGHT_INPUT_MAX_LINES;
}

function autoGrowThoughtInput() {
  const thoughtInput = document.getElementById("thoughtInput");
  if (!thoughtInput) return;

  const maxLines = getThoughtInputMaxLines();
  const styles = window.getComputedStyle(thoughtInput);
  const lineHeight = parseFloat(styles.lineHeight) || 18;
  const paddingTop = parseFloat(styles.paddingTop) || 0;
  const paddingBottom = parseFloat(styles.paddingBottom) || 0;
  const borderTop = parseFloat(styles.borderTopWidth) || 0;
  const borderBottom = parseFloat(styles.borderBottomWidth) || 0;
  const maxVisibleHeight = Math.ceil(
    paddingTop + paddingBottom + borderTop + borderBottom + lineHeight * maxLines
  );
  thoughtInput.style.maxHeight = `${maxVisibleHeight}px`;
  const mirrorId = "thoughtInputMeasure";
  let mirror = document.getElementById(mirrorId);

  if (!mirror) {
    mirror = document.createElement("div");
    mirror.id = mirrorId;
    document.body.appendChild(mirror);
  }

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.left = "-9999px";
  mirror.style.top = "0";
  mirror.style.zIndex = "-1";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordBreak = "break-word";
  mirror.style.overflowWrap = "anywhere";
  mirror.style.boxSizing = styles.boxSizing;
  mirror.style.width = `${thoughtInput.clientWidth}px`;
  mirror.style.padding = styles.padding;
  mirror.style.border = styles.border;
  mirror.style.font = styles.font;
  mirror.style.letterSpacing = styles.letterSpacing;
  mirror.style.lineHeight = styles.lineHeight;

  if (!thoughtInput.value.trim()) {
    thoughtInput.style.height = `${THOUGHT_INPUT_MIN_HEIGHT}px`;
    thoughtInput.style.overflowY = "hidden";
    return;
  }

  mirror.textContent = thoughtInput.value;

  const measuredHeight = Math.ceil(mirror.getBoundingClientRect().height);
  const targetHeight = Math.max(
    THOUGHT_INPUT_MIN_HEIGHT,
    Math.min(maxVisibleHeight, measuredHeight)
  );

  thoughtInput.style.height = `${targetHeight}px`;
  thoughtInput.style.overflowY = measuredHeight > maxVisibleHeight ? "auto" : "hidden";
}

function syncBetaAccessInputMask() {
  const input = document.getElementById("betaAccessInput");
  if (!input) return;

  const shouldMask = String(input.value || "").startsWith("6");
  const nextType = shouldMask ? "password" : "text";

  if (input.type !== nextType) {
    input.type = nextType;
  }
}

function buildApiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function getStoredBetaAccessKey() {
  return localStorage.getItem(BETA_ACCESS_STORAGE_KEY) || "";
}

function getStoredBetaClientId() {
  return localStorage.getItem(BETA_CLIENT_ID_STORAGE_KEY) || "";
}

function buildBetaClientId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `cs-beta-${window.crypto.randomUUID()}`;
  }

  return `cs-beta-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function getOrCreateBetaClientId() {
  const current = getStoredBetaClientId();
  if (current) return current;

  const next = buildBetaClientId();
  localStorage.setItem(BETA_CLIENT_ID_STORAGE_KEY, next);
  return next;
}

function storeBetaAccessKey(value) {
  localStorage.setItem(BETA_ACCESS_STORAGE_KEY, value);
}

function clearStoredBetaAccessKey() {
  localStorage.removeItem(BETA_ACCESS_STORAGE_KEY);
}

function getBetaAccessAuth() {
  return {
    beta_access_key: getStoredBetaAccessKey(),
    beta_client_id: getOrCreateBetaClientId(),
  };
}

function getStoredApiKey() {
  return sessionStorage.getItem(API_KEY_STORAGE_KEY) || "";
}

function getStoredProvider() {
  return normalizeProvider(sessionStorage.getItem(API_PROVIDER_STORAGE_KEY) || apiProvider);
}

function storeApiKey(value) {
  sessionStorage.setItem(API_KEY_STORAGE_KEY, value);
}

function clearStoredApiKey() {
  sessionStorage.removeItem(API_KEY_STORAGE_KEY);
}

function isBetaAccessError(message) {
  return String(message || "").toLowerCase().includes("beta access key");
}

function getDefaultApiGateMessage() {
  if (!betaAccessReady) {
    return "Enter your beta access key to unlock API registration.";
  }

  const providerLabel = getProviderLabel();
  return apiReady
    ? `${providerLabel} API key ready in this browser session. It is not stored on the server.`
    : `Choose ${providerLabel} and submit your API key to start.`;
}

function setBetaStatusText(message) {
  const status = document.getElementById("betaAccessStatus");
  if (!status) return;
  const text = String(message || "");
  if (text.startsWith("⚠")) {
    const body = escapeHtml(text.replace(/^⚠\s*/, ""));
    status.innerHTML = `<span class="beta-access-status-icon">⚠</span><span class="beta-access-status-text">${body}</span>`;
    return;
  }
  status.textContent = text;
}

function formatBetaRank(meta = betaAccessMeta) {
  if (!meta) return "";
  if (meta.master) return "WElcome Dev-100RAV";
  if (meta.testerNumber) return `#${String(meta.testerNumber).padStart(2, "0")}`;
  return "";
}

function syncBetaRank(meta = betaAccessMeta) {
  const rank = document.getElementById("betaAccessRank");
  if (!rank) return;

  const text = betaAccessReady ? formatBetaRank(meta) : "";
  rank.textContent = text;
  rank.classList.toggle("is-visible", Boolean(text));
  rank.classList.toggle("is-master", betaAccessReady && Boolean(meta && meta.master));
}

function syncBetaDependentUI() {
  const apiWidget = document.getElementById("api-registration");
  const widget = document.getElementById("codesentinel");
  const apiInput = document.getElementById("apiKeyInput");
  const apiSubmitBtn = document.getElementById("apiSubmitBtn");
  const apiRemoveBtn = document.getElementById("apiRemoveBtn");
  const widgetControls = [
    document.getElementById("debugModeBtn"),
    document.getElementById("fixModeBtn"),
    document.getElementById("thoughtBtn"),
    document.getElementById("hintBtn"),
    document.getElementById("doneBtn"),
    document.getElementById("codeInput"),
    document.getElementById("thoughtInput")
  ];
  const widgetReady = betaAccessReady && apiReady;

  if (apiWidget) {
    apiWidget.classList.toggle("is-beta-locked", !betaAccessReady);
  }

  document.querySelectorAll(".api-provider-option").forEach((button) => {
    button.disabled = !betaAccessReady;
  });

  if (apiInput) {
    apiInput.disabled = !betaAccessReady;
  }

  if (apiSubmitBtn) {
    apiSubmitBtn.disabled = !betaAccessReady;
  }

  if (apiRemoveBtn) {
    apiRemoveBtn.disabled = !betaAccessReady || !apiReady;
  }

  if (widget) {
    widget.classList.toggle("is-locked", !widgetReady);
  }

  widgetControls.forEach((el) => {
    if (!el) return;
    el.disabled = !widgetReady;
  });

  if (!widgetReady) {
    setCoachButtons(false);
    setStatus("LOCKED", "error");
  } else {
    setStatus("IDLE", "idle");
  }
}

function handleBetaAccessFailure(message) {
  clearStoredBetaAccessKey();
  betaAccessReady = false;
  betaAccessMeta = null;
  const input = document.getElementById("betaAccessInput");
  if (input) {
    input.value = "";
  }
  syncBetaAccessInputMask();
  setBetaGate(false, message || "Beta access key check failed. Enter a valid beta key to continue.");
}

function handleApiKeyFailure(message) {
  abandonActiveRun();
  clearStoredApiKey();
  debugState = null;
  setCoachButtons(false);
  setApiGate(false, message || `${getProviderLabel()} API key check failed. Enter your key again.`);
}

function getStatsElements() {
  return {
    panel: document.getElementById("statsPanel"),
    runs: document.getElementById("statRuns"),
    thoughts: document.getElementById("statThoughts"),
    hints: document.getElementById("statHints"),
    wrongTurns: document.getElementById("statWrongTurns"),
    bugReads: document.getElementById("statBugReads"),
    progressText: document.getElementById("statProgress"),
    bestProgress: document.getElementById("statBestProgress"),
    progressFill: document.getElementById("progressFill"),
    note: document.getElementById("statsNote"),
    downloadBtn: document.getElementById("downloadStatsBtn"),
    fullRecordBtn: document.getElementById("downloadAdvancedStatsBtn"),
    advancedProgressText: document.getElementById("advancedProgressPercent"),
    advancedProgressFill: document.getElementById("advancedProgressFill"),
    giveUpRate: document.getElementById("advancedGiveUpRate"),
    hintDependency: document.getElementById("advancedHintDependency"),
    solveStreak: document.getElementById("advancedSolveStreak"),
    timeToSolve: document.getElementById("advancedTimeToSolve"),
    firstTryAccuracy: document.getElementById("advancedFirstTryAccuracy"),
    advancedWrongTurns: document.getElementById("advancedWrongTurns"),
  };
}

function setApiStatusText(message, animate = false) {
  const status = document.getElementById("apiStatusText");
  if (!status) return;

  if (apiStatusTimer) {
    clearTimeout(apiStatusTimer);
    apiStatusTimer = null;
  }

  if (!animate) {
    status.innerHTML = formatApiStatusMessage(message);
    return;
  }

  let index = 0;
  status.textContent = "";

  const typeNext = () => {
    status.textContent = message.slice(0, index + 1);
    index += 1;

    if (index < message.length) {
      apiStatusTimer = setTimeout(typeNext, 22);
    } else {
      apiStatusTimer = null;
      status.innerHTML = formatApiStatusMessage(message);
    }
  };

  typeNext();
}

function normalizeDebugMode(value) {
  return DEBUG_MODE_CONTENT[value] ? value : "beginner";
}

function renderDebugModeUI() {
  const panel = document.getElementById("debugModePanel");
  const selector = document.getElementById("debugModeSelector");
  const allowedList = document.getElementById("debugModeAllowedList");
  const restrictedList = document.getElementById("debugModeRestrictedList");
  const bestForList = document.getElementById("debugModeBestForList");
  const shouldShow = mode === "debug" && advancedStatsVisible;
  const currentMode = DEBUG_MODE_CONTENT[debugMode] || DEBUG_MODE_CONTENT.beginner;

  if (panel) {
    panel.style.display = shouldShow ? "flex" : "none";
  }

  if (selector) {
    selector.dataset.active = debugMode;
    selector.style.setProperty("--debug-mode-index", String(currentMode.index));
    selector.style.setProperty("--debug-mode-color", currentMode.color);
  }

  document.querySelectorAll(".debug-mode-option").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.debugMode === debugMode);
  });

  if (allowedList) {
    allowedList.innerHTML = currentMode.allowed
      .map((item) => `<div class="debug-mode-list-item is-allowed"><span class="debug-mode-icon">✔</span><span>${escapeHtml(item)}</span></div>`)
      .join("");
  }

  if (restrictedList) {
    restrictedList.innerHTML = currentMode.restricted
      .map((item) => `<div class="debug-mode-list-item is-restricted"><span class="debug-mode-icon">✖</span><span>${escapeHtml(item)}</span></div>`)
      .join("");
  }

  if (bestForList) {
    bestForList.innerHTML = currentMode.bestFor
      .map((item) => `<div class="debug-mode-list-item is-bestfor"><span class="debug-mode-icon">→</span><span>${escapeHtml(item)}</span></div>`)
      .join("");
  }
}

function setDebugMode(nextMode) {
  debugMode = normalizeDebugMode(nextMode);

  if (debugState) {
    debugState.debug_mode = debugMode;
  }

  renderDebugModeUI();
}

function syncAdvancedStatsUI() {
  const widget = document.getElementById("codesentinel");
  const toggleBtn = document.getElementById("toggleAdvancedStatsBtn");
  const shouldShow = mode === "debug" && advancedStatsVisible;

  if (widget) {
    widget.classList.toggle("advanced-stats-visible", shouldShow);
  }

  if (toggleBtn) {
    toggleBtn.textContent = shouldShow ? "Hide Advanced Stats" : "Show Advanced Stats";
    toggleBtn.setAttribute("aria-expanded", shouldShow ? "true" : "false");
  }

  renderDebugModeUI();
}

function toggleAdvancedStats() {
  advancedStatsVisible = !advancedStatsVisible;
  syncAdvancedStatsUI();
}

function setBetaGate(ready, message = "", meta = null) {
  betaAccessReady = ready;
  betaAccessMeta = ready ? (meta || betaAccessMeta) : null;

  const card = document.getElementById("betaAccessCard");
  const input = document.getElementById("betaAccessInput");
  const submitBtn = document.getElementById("betaAccessSubmitBtn");
  const removeBtn = document.getElementById("betaAccessRemoveBtn");
  const status = document.getElementById("betaAccessStatus");
  const statusMessage = message || (
    ready
      ? "Beta access key ready in this browser."
      : "⚠ Enter your beta access key to unlock this beta build."
  );

  if (card) {
    card.classList.toggle("is-ready", ready);
  }

  if (input) {
    input.disabled = ready;
  }
  syncBetaAccessInputMask();

  if (submitBtn) {
    submitBtn.disabled = ready;
  }

  if (removeBtn) {
    removeBtn.disabled = !ready;
  }

  if (status) {
    status.classList.toggle("is-ready", ready);
    status.classList.toggle("is-error", !ready && Boolean(message));
  }

  setBetaStatusText(statusMessage);
  syncBetaRank();
  syncBetaDependentUI();
  setApiGate(apiReady);
}

function setApiGate(ready, message = "") {
  apiReady = ready;

  const status = document.getElementById("apiStatusText");
  syncBetaDependentUI();

  if (status) {
    const statusMessage = message || getDefaultApiGateMessage();
    status.classList.toggle("is-ready", betaAccessReady && ready);
    status.classList.toggle("is-error", betaAccessReady && !ready && Boolean(message));
    setApiStatusText(statusMessage, betaAccessReady && ready);
  }
}

function syncApiStatus() {
  apiProvider = getStoredProvider();
  renderProviderSelector();
  const storedKey = getStoredApiKey();
  setApiGate(Boolean(storedKey));
}

async function syncBetaAccess() {
  const storedKey = getStoredBetaAccessKey();
  const betaClientId = getOrCreateBetaClientId();

  if (!storedKey) {
    setBetaGate(false, "⚠ Enter your beta access key to unlock this beta build.");
    return;
  }

  try {
    const res = await fetch(buildApiUrl("/beta-access"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ beta_access_key: storedKey, beta_client_id: betaClientId })
    });
    const data = await res.json();

    if (!res.ok) {
      handleBetaAccessFailure(data.error || "Beta access key check failed.");
      return;
    }

    setBetaGate(true, data.message || "Beta access key ready in this browser.", {
      label: data.label,
      testerNumber: data.tester_number,
      master: Boolean(data.master)
    });
  } catch (error) {
    handleBetaAccessFailure("Beta access check failed. Try your beta key again.");
  }
}

async function submitBetaAccess() {
  const input = document.getElementById("betaAccessInput");
  const betaKey = input.value.trim();
  const betaClientId = getOrCreateBetaClientId();

  if (!betaKey) {
    setBetaGate(false, "Enter your beta access key first.");
    return;
  }

  try {
    const res = await fetch(buildApiUrl("/beta-access"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ beta_access_key: betaKey, beta_client_id: betaClientId })
    });
    const data = await res.json();

    if (!res.ok) {
      setBetaGate(false, data.error || "Beta access key rejected.");
      return;
    }

    storeBetaAccessKey(betaKey);
    input.value = "";
    setBetaGate(true, data.message || "Beta access key ready in this browser.", {
      label: data.label,
      testerNumber: data.tester_number,
      master: Boolean(data.master)
    });
  } catch (error) {
    setBetaGate(false, "Beta access server not reachable. Try again.");
  }
}

function removeBetaAccess() {
  clearStoredBetaAccessKey();
  setBetaGate(false, "⚠ Beta access key removed from this browser.");
}

async function submitApiKey() {
  const input = document.getElementById("apiKeyInput");
  const key = input.value.trim();

  if (!betaAccessReady) {
    setBetaGate(false, "Enter your beta access key first.");
    return;
  }

  if (!key) {
    setApiGate(false, "Paste your API key first, then hit submit.");
    return;
  }

  const betaAccessKey = getStoredBetaAccessKey();
  const betaAccessAuth = getBetaAccessAuth();

  try {
    const res = await fetch(buildApiUrl("/api-key"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, provider: apiProvider, ...betaAccessAuth })
    });
    const data = await res.json();

    if (!res.ok) {
      if (isBetaAccessError(data.error)) {
        handleBetaAccessFailure(data.error);
        return;
      }
      setApiGate(false, data.error || "API key submission failed.");
      return;
    }

    storeApiKey(key);
    input.value = "";
    setApiGate(true, data.message || `${getProviderLabel()} API key ready in this browser session. It is not stored on the server.`);
  } catch (error) {
    setApiGate(false, `Backend not reachable for ${getProviderLabel()}. Start the server and submit your API key.`);
  }
}

function removeApiKey() {
  abandonActiveRun();
  clearStoredApiKey();
  document.getElementById("apiKeyInput").value = "";
  document.getElementById("chatBox").innerHTML = "> API key removed. Submit a new key to start again.";
  fixState.fixedCode = "";
  fixState.changeLog = [];
  renderFixResults();
  resetSessionState();
  setApiGate(false, `${getProviderLabel()} API key removed from this browser session.`);
}

function clampProgress(value) {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function formatPercent(value) {
  return `${Math.round(clampProgress(value))}%`;
}

function getProgressColor(value) {
  if (value <= 33.5) return "#ff2d37";
  if (value <= 66.5) return "#f5b400";
  return "#00ff88";
}

function calculateRate(count, total) {
  if (!total) return 0;
  return clampProgress((count / total) * 100);
}

function beginDebugRun() {
  abandonActiveRun();
  statsState.activeRun = {
    startedAt: Date.now(),
    thoughts: 0,
    wrongTurns: 0,
    usedHint: false,
  };
}

function noteThoughtAttempt() {
  if (statsState.activeRun) {
    statsState.activeRun.thoughts += 1;
  }
}

function noteWrongTurn() {
  statsState.wrongTurns += 1;

  if (statsState.activeRun) {
    statsState.activeRun.wrongTurns += 1;
  }
}

function noteHintDependency() {
  const run = statsState.activeRun;
  if (!run || run.usedHint) return;

  run.usedHint = true;
  statsState.hintRuns += 1;
}

function completeActiveRun() {
  const run = statsState.activeRun;
  if (!run) return;

  const elapsedSeconds = Math.max(1, Math.round((Date.now() - run.startedAt) / 1000));
  statsState.solvedRuns += 1;
  statsState.totalSolveSeconds += elapsedSeconds;

  if (!run.usedHint) {
    statsState.independentSolveStreak += 1;
  } else {
    statsState.independentSolveStreak = 0;
  }

  if (!run.usedHint && run.wrongTurns === 0 && run.thoughts <= 1) {
    statsState.firstTryWins += 1;
  }

  statsState.activeRun = null;
}

function abandonActiveRun() {
  if (!statsState.activeRun) return;

  statsState.giveUps += 1;
  statsState.independentSolveStreak = 0;
  statsState.activeRun = null;
}

function getAdvancedStats() {
  const timeToSolve = statsState.solvedRuns
    ? `${Math.max(1, Math.round(statsState.totalSolveSeconds / statsState.solvedRuns))}s`
    : "0s";

  return {
    learningProgress: formatPercent(statsState.progress),
    giveUpRate: formatPercent(calculateRate(statsState.giveUps, statsState.runs)),
    hintDependency: formatPercent(calculateRate(statsState.hintRuns, statsState.runs)),
    independentSolveStreak: String(statsState.independentSolveStreak),
    timeToSolve,
    firstTryAccuracy: formatPercent(calculateRate(statsState.firstTryWins, statsState.runs)),
    wrongTurns: String(statsState.wrongTurns),
  };
}

function hasRecordedStats() {
  return (
    statsState.runs > 0 ||
    statsState.thoughts > 0 ||
    statsState.hints > 0 ||
    statsState.wrongTurns > 0 ||
    statsState.bugReads > 0 ||
    statsState.giveUps > 0 ||
    statsState.hintRuns > 0 ||
    statsState.solvedRuns > 0 ||
    statsState.totalSolveSeconds > 0 ||
    statsState.firstTryWins > 0 ||
    statsState.progress > 0 ||
    statsState.bestProgress > 0
  );
}

function downloadTextFile(filename, lines) {
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function updateStatsUI() {
  const els = getStatsElements();
  if (!els.panel) return;
  const advancedStats = getAdvancedStats();

  els.panel.style.display = mode === "debug" ? "block" : "none";
  els.runs.textContent = String(statsState.runs);
  els.thoughts.textContent = String(statsState.thoughts);
  els.hints.textContent = String(statsState.hints);
  els.wrongTurns.textContent = String(statsState.wrongTurns);
  els.bugReads.textContent = String(statsState.bugReads);
  els.progressText.textContent = `${Math.round(statsState.progress)}%`;
  els.bestProgress.textContent = `${Math.round(statsState.bestProgress)}%`;
  els.note.textContent = statsState.note;

  const hasStats = hasRecordedStats();
  if (els.downloadBtn) {
    els.downloadBtn.style.display = hasStats ? "inline-flex" : "none";
  }
  if (els.fullRecordBtn) {
    els.fullRecordBtn.style.display = hasStats && advancedStatsVisible && mode === "debug" ? "inline-flex" : "none";
  }

  const progressColor = getProgressColor(statsState.progress);
  els.progressFill.style.width = `${statsState.progress}%`;
  els.progressFill.style.background = `linear-gradient(90deg, ${progressColor}, ${progressColor})`;
  els.progressFill.style.boxShadow = `0 0 18px ${progressColor}`;

  els.advancedProgressText.textContent = advancedStats.learningProgress;
  els.advancedProgressText.style.color = progressColor;
  els.advancedProgressFill.style.width = `${statsState.progress}%`;
  els.advancedProgressFill.style.background = `linear-gradient(90deg, ${progressColor}, ${progressColor})`;
  els.advancedProgressFill.style.boxShadow = `0 0 20px ${progressColor}`;
  els.giveUpRate.textContent = advancedStats.giveUpRate;
  els.hintDependency.textContent = advancedStats.hintDependency;
  els.solveStreak.textContent = advancedStats.independentSolveStreak;
  els.timeToSolve.textContent = advancedStats.timeToSolve;
  els.firstTryAccuracy.textContent = advancedStats.firstTryAccuracy;
  els.advancedWrongTurns.textContent = advancedStats.wrongTurns;

  const firstTryValue = calculateRate(statsState.firstTryWins, statsState.runs);
  els.firstTryAccuracy.classList.remove("stat-danger-text", "stat-warning-text");
  els.firstTryAccuracy.classList.add(firstTryValue <= 30 ? "stat-danger-text" : "stat-warning-text");
  renderDebugModeUI();
}

function updateProgress(nextValue, note) {
  const newValue = clampProgress(nextValue);
  statsState.bestProgress = Math.max(statsState.bestProgress, newValue);
  statsState.lastDelta = newValue - statsState.progress;
  statsState.progress = newValue;

  if (note) {
    statsState.note = note;
  } else if (statsState.lastDelta > 0) {
    statsState.note = "Nice, you are getting closer to the bug fix.";
  } else if (statsState.lastDelta < 0) {
    statsState.note = "Oops, that moved a bit away. Re-check the code carefully.";
  } else {
    statsState.note = "Hold on. Read the code one more time and try again.";
  }

  updateStatsUI();
}

function resetStatsProgress() {
  statsState.progress = 0;
  statsState.lastDelta = 0;
  statsState.note = "Start a debug run and the tracker will wake up.";
  updateStatsUI();
}

function resetAllStats() {
  statsState.runs = 0;
  statsState.thoughts = 0;
  statsState.hints = 0;
  statsState.wrongTurns = 0;
  statsState.bugReads = 0;
  statsState.giveUps = 0;
  statsState.hintRuns = 0;
  statsState.solvedRuns = 0;
  statsState.totalSolveSeconds = 0;
  statsState.firstTryWins = 0;
  statsState.independentSolveStreak = 0;
  statsState.progress = 0;
  statsState.bestProgress = 0;
  statsState.lastDelta = 0;
  statsState.activeRun = null;
  statsState.note = "Stats reset. Start a fresh debug run.";
  updateStatsUI();
}

function setAlreadyCleanStats(message) {
  statsState.runs = 0;
  statsState.thoughts = 0;
  statsState.hints = 0;
  statsState.wrongTurns = 0;
  statsState.bugReads = 0;
  statsState.giveUps = 0;
  statsState.hintRuns = 0;
  statsState.solvedRuns = 0;
  statsState.totalSolveSeconds = 0;
  statsState.firstTryWins = 0;
  statsState.independentSolveStreak = 0;
  statsState.progress = 100;
  statsState.bestProgress = 100;
  statsState.lastDelta = 0;
  statsState.activeRun = null;
  statsState.note = message || "Code already looks clean.";
  updateStatsUI();
}

function downloadStats() {
  const lines = [
    "CodeSentinel Stats Export",
    `Generated: ${new Date().toLocaleString()}`,
    `Mode: ${mode.toUpperCase()}`,
    `Debug Runs: ${statsState.runs}`,
    `Thoughts Sent: ${statsState.thoughts}`,
    `Hints Used: ${statsState.hints}`,
    `Wrong Turns: ${statsState.wrongTurns}`,
    `Bug Reads: ${statsState.bugReads}`,
    `Progress: ${Math.round(statsState.progress)}%`,
    `Best Progress: ${Math.round(statsState.bestProgress)}%`,
    `Note: ${statsState.note}`,
  ];

  downloadTextFile("codesentinel-stats.txt", lines);
}

function downloadAdvancedStats() {
  const advancedStats = getAdvancedStats();
  const lines = [
    "CodeSentinel Full Stats Record",
    `Generated: ${new Date().toLocaleString()}`,
    "",
    "Normal Stats",
    `Mode: ${mode.toUpperCase()}`,
    `Debug Runs: ${statsState.runs}`,
    `Thoughts Sent: ${statsState.thoughts}`,
    `Hints Used: ${statsState.hints}`,
    `Wrong Turns: ${statsState.wrongTurns}`,
    `Bug Reads: ${statsState.bugReads}`,
    `Progress: ${Math.round(statsState.progress)}%`,
    `Best Progress: ${Math.round(statsState.bestProgress)}%`,
    `Note: ${statsState.note}`,
    "",
    "Advanced Stats",
    `Learning Progress: ${advancedStats.learningProgress}`,
    `Give Up Rate: ${advancedStats.giveUpRate}`,
    `Hint Dependency: ${advancedStats.hintDependency}`,
    `Independent Solve Streak: ${advancedStats.independentSolveStreak}`,
    `Time to Solve: ${advancedStats.timeToSolve}`,
    `First Try Accuracy: ${advancedStats.firstTryAccuracy}`,
    `Wrong Turns: ${advancedStats.wrongTurns}`,
    "",
    "Made with love by 100RAV. Keep learning, keep cooking bugs."
  ];

  downloadTextFile("codesentinel-full-stats.txt", lines);
}

function renderFixResults() {
  const panel = document.getElementById("fixResultsPanel");
  const codeBox = document.getElementById("fixedCodeBox");
  const changeLogBox = document.getElementById("changeLogBox");
  const chatBox = document.getElementById("chatBox");

  if (!panel || !codeBox || !changeLogBox || !chatBox) return;

  const inFixMode = mode === "fix";
  panel.style.display = inFixMode ? "grid" : "none";
  chatBox.style.display = inFixMode ? "none" : "block";

  codeBox.innerHTML = highlightCode(fixState.fixedCode);

  if (Array.isArray(fixState.changeLog) && fixState.changeLog.length) {
    changeLogBox.innerHTML = fixState.changeLog
      .map((item) => `<div class="change-log-line">${escapeHtml(item)}</div>`)
      .join("");
  } else {
    changeLogBox.textContent = "Fix mode will show what the AI changed here.";
  }
}

function setMode(m) {
  if (mode === "debug" && m === "fix") {
    abandonActiveRun();
  }

  mode = m;
  const widget = document.getElementById("codesentinel");
  const modeLabel = document.getElementById("modeLabel");
  modeLabel.innerText = m.toUpperCase();
  modeLabel.classList.remove("mode-debug", "mode-fix", "chip-pulse");
  modeLabel.classList.add(m === "debug" ? "mode-debug" : "mode-fix", "chip-pulse");

  if (widget) {
    widget.classList.toggle("mode-fix", m === "fix");
    widget.classList.toggle("mode-debug", m === "debug");
  }

  const debugBtn = document.getElementById("debugModeBtn");
  const fixBtn = document.getElementById("fixModeBtn");

  if (m === "debug") {
    debugBtn.classList.remove("btn-ghost");
    fixBtn.classList.add("btn-ghost");
  } else {
    fixBtn.classList.remove("btn-ghost");
    debugBtn.classList.add("btn-ghost");
  }

  syncAdvancedStatsUI();
  updateStatsUI();
  renderFixResults();
}

function setStatus(text, state = "idle") {
  const statusEl = document.getElementById("csStatus");
  statusEl.innerText = text;
  statusEl.classList.remove("status-idle", "status-running", "status-output", "status-done", "status-error", "chip-pulse");

  if (state === "running") {
    statusEl.classList.add("status-running", "chip-pulse");
    return;
  }

  if (state === "output") {
    statusEl.classList.add("status-output");
    return;
  }

  if (state === "done") {
    statusEl.classList.add("status-done");
    return;
  }

  if (state === "error") {
    statusEl.classList.add("status-error");
    return;
  }

  statusEl.classList.add("status-idle");
}

function setCoachButtons(active) {
  document.getElementById("thoughtBtn").disabled = !active;
  document.getElementById("hintBtn").disabled = !active;
  document.getElementById("doneBtn").disabled = !active;
}

function appendChat(text, options = {}) {
  const box = document.getElementById("chatBox");
  const raw = String(text);
  const trimmed = raw.trim();
  let formatted = options.html ? raw : escapeHtml(raw).replace(/\n/g, "<br>");
  let lineClass = options.lineClass || "chat-ai-reply";

  if (trimmed.startsWith("My thought:")) {
    lineClass = "chat-user-thought";
  }

  if (trimmed === FOUND_MESSAGE) {
    formatted = `<span class="chat-bugfound">${formatted}</span>`;
  }

  if (trimmed === DONE_MESSAGE) {
    formatted = `<span class="chat-success">${formatted}</span>`;
  }

  box.innerHTML += `<div class="chat-line ${lineClass}">&gt; ${formatted}</div>`;
  box.scrollTop = box.scrollHeight;
}

function resetSessionState() {
  debugState = null;
  const thoughtInput = document.getElementById("thoughtInput");
  thoughtInput.value = "";
  autoGrowThoughtInput();
  setCoachButtons(false);
}

function clearChat() {
  abandonActiveRun();
  document.getElementById("chatBox").innerHTML = "> cleared";
  fixState.fixedCode = "";
  fixState.changeLog = [];
  resetSessionState();
  resetStatsProgress();
  renderFixResults();
  setStatus("IDLE", "idle");
}

function showHelp() {
  appendChat('<span class="chat-help-title">How to use CodeSentinel:</span>', { html: true });
  appendChat('<span class="chat-help">1. Paste broken code in the input box.</span>', { html: true });
  appendChat('<span class="chat-help">2. Click <span class="chat-help-btn">Run</span> or press <span class="chat-help-btn">Shift + Enter</span> in Input Code.</span>', { html: true });
  appendChat('<span class="chat-help">3. Use <span class="chat-help-btn">Send</span> or press <span class="chat-help-btn">Shift + Enter</span> in Thought Input.</span>', { html: true });
  appendChat('<span class="chat-help">4. Press normal <span class="chat-help-btn">Enter</span> for a new line while typing.</span>', { html: true });
  appendChat('<span class="chat-help">5. Use <span class="chat-help-btn">Next Hint</span> if you want another clue.</span>', { html: true });
  appendChat('<span class="chat-help">6. Use <span class="chat-help-btn">Fix</span> mode for direct corrected code.</span>', { html: true });
  appendChat('<span class="chat-help-command-label">Commands:</span> <span class="chat-help-command-value">/help, clear, clr</span>', { html: true });
}

function handleLocalCommand(value) {
  const command = value.trim().toLowerCase();

  if (["clear", "clr"].includes(command)) {
    clearChat();
    document.getElementById("codeInput").value = "";
    return true;
  }

  if (command === "/help") {
    showHelp();
    setStatus("IDLE", "idle");
    return true;
  }

  return false;
}

function handleServerCommand(data) {
  if (!data || !data.command) return false;

  if (data.command === "clear") {
    clearChat();
    document.getElementById("codeInput").value = "";
    return true;
  }

  if (data.command === "help") {
    showHelp();
    setStatus("IDLE", "idle");
    return true;
  }

  return false;
}

async function sendCode() {
  const code = document.getElementById("codeInput").value.trim();
  const apiKey = getStoredApiKey();
  const betaAccessKey = getStoredBetaAccessKey();
  const betaAccessAuth = getBetaAccessAuth();

  if (handleLocalCommand(code)) return;

  if (!betaAccessReady || !betaAccessKey) {
    appendChat("Enter your beta access key first, then continue.", { lineClass: "chat-wrong-reply" });
    return;
  }

  if (!apiReady || !apiKey) {
    appendChat("Register your API key first, then start debugging.", { lineClass: "chat-wrong-reply" });
    return;
  }

  if (!code) {
    appendChat("No code entered");
    return;
  }

  setCoachButtons(false);
  debugState = null;
  setStatus("RUNNING", "running");

  if (mode === "fix") {
    fixState.fixedCode = "// generating fixed code...";
    fixState.changeLog = ["Reading your code and preparing the fix notes..."];
    renderFixResults();
  }

  if (mode === "debug") {
    beginDebugRun();
    appendChat("Processing...");
    statsState.runs += 1;
    updateProgress(Math.max(statsState.progress, 8), "Debug run started. Read the code slowly.");
  }

  try {
    const res = await fetch(buildApiUrl("/debug"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, mode, debug_mode: debugMode, provider: apiProvider, api_key: apiKey, ...betaAccessAuth })
    });

    const data = await res.json();
    if (handleServerCommand(data)) return;

    if (!res.ok) {
      if (isBetaAccessError(data.error)) {
        handleBetaAccessFailure(data.error);
        return;
      }
      if ((data.error || "").toLowerCase().includes("api key")) {
        handleApiKeyFailure(data.error);
        return;
      }

      if (mode === "fix") {
        fixState.fixedCode = "// unable to generate fixed code right now";
        fixState.changeLog = [data.error || "Fix mode hit an error while reading the code."];
        renderFixResults();
      } else {
        appendChat(data.error || "Error", { lineClass: "chat-wrong-reply" });
        noteWrongTurn();
        updateProgress(statsState.progress - 12, "Oops, that input did not move toward a fix.");
      }

      setStatus("ERROR", "error");
      return;
    }

    if (mode === "fix") {
      debugState = null;
      setCoachButtons(false);
      fixState.fixedCode = data.fixed_code || "";
      fixState.changeLog = Array.isArray(data.change_log) ? data.change_log : [];
      document.getElementById("thoughtInput").value = "";
      autoGrowThoughtInput();
      renderFixResults();
      setStatus("OUTPUT", "output");
      return;
    }

    if (data.already_clean) {
      appendChat(data.message || "Yo this code is already clean, no bug drama here. You cooked fine.", {
        lineClass: "chat-clean-reply"
      });
      resetSessionState();
      setAlreadyCleanStats(data.message || "Code already looks clean.");
      setStatus("OUTPUT", "output");
      return;
    }

    debugState = data.debug_state || {
      code,
      hint_step: 0,
      bug_found: false,
      last_thought: "",
      debug_mode: debugMode,
      provider: apiProvider
    };
    setCoachButtons(true);
    appendChat(data.message || "Where do you think the problem is?");
    setStatus("OUTPUT", "output");
    updateProgress(statsState.progress + 6, "Good start. Now tell the system where the bug may be.");
  } catch (error) {
    if ((error.message || "").toLowerCase().includes("api key")) {
      handleApiKeyFailure(error.message);
      return;
    }

    if (mode === "fix") {
      fixState.fixedCode = "// unable to generate fixed code right now";
      fixState.changeLog = [error.message || "Fix mode lost connection while talking to the server."];
      renderFixResults();
    } else {
      appendChat(error.message || "Connection error", { lineClass: "chat-wrong-reply" });
      noteWrongTurn();
      updateProgress(statsState.progress - 10, "Oops, the request failed. Try again.");
    }

    setStatus("ERROR", "error");
  }
}

async function submitThought() {
  const thought = document.getElementById("thoughtInput").value.trim();
  const apiKey = getStoredApiKey();
  const betaAccessKey = getStoredBetaAccessKey();
  const betaAccessAuth = getBetaAccessAuth();

  if (!betaAccessReady || !betaAccessKey) {
    appendChat("Enter your beta access key first, then continue.", { lineClass: "chat-wrong-reply" });
    return;
  }

  if (!apiReady || !apiKey) {
    appendChat("Register your API key first, then send a thought.", { lineClass: "chat-wrong-reply" });
    return;
  }

  if (!debugState || !debugState.code) {
    appendChat("Run the code first");
    return;
  }

  if (!thought) {
    appendChat("Write where you think the problem is first");
    return;
  }

  statsState.thoughts += 1;
  noteThoughtAttempt();
  debugState.debug_mode = debugMode;
  debugState.provider = apiProvider;
  appendChat(`My thought: ${thought}`);
  document.getElementById("thoughtInput").value = "";
  autoGrowThoughtInput();
  setStatus("RUNNING", "running");

  try {
    const res = await fetch(buildApiUrl("/submit-thought"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debug_state: debugState, thought, debug_mode: debugMode, provider: apiProvider, api_key: apiKey, ...betaAccessAuth })
    });

    const data = await res.json();
    if (isBetaAccessError(data.error)) {
      handleBetaAccessFailure(data.error);
      return;
    }
    if ((data.error || "").toLowerCase().includes("api key")) {
      handleApiKeyFailure(data.error);
      return;
    }

    const replyClass = data.thought_state === "wrong" || data.thought_state === "wrong_fix" ? "chat-wrong-reply" : undefined;
    appendChat(data.message || data.error || "Error", { lineClass: replyClass });

    if (data.done) {
      statsState.bugReads += 1;
      completeActiveRun();
      updateProgress(100, "Locked in. Full fix reached.");
      setStatus("DONE", "done");
      resetSessionState();
      return;
    }

    debugState = data.debug_state || debugState;

    if (data.thought_state === "correct_bug") {
      statsState.bugReads += 1;
      updateProgress(Math.max(statsState.progress + 22, 55), "Nice catch. You are getting close now.");
    } else if (data.thought_state === "close_fix") {
      updateProgress(statsState.progress + 10, "Nice. That fix attempt is moving in the right direction.");
    } else {
      noteWrongTurn();
      updateProgress(statsState.progress - 14, "Oops, wrong catch. Try a different part of the code.");
    }

    setStatus(res.ok ? "OUTPUT" : "ERROR", res.ok ? "output" : "error");
  } catch (error) {
    if ((error.message || "").toLowerCase().includes("api key")) {
      handleApiKeyFailure(error.message);
      return;
    }

    appendChat(error.message || "Connection error", { lineClass: "chat-wrong-reply" });
    noteWrongTurn();
    updateProgress(statsState.progress - 10, "Oops, the request failed. Try again.");
    setStatus("ERROR", "error");
  }
}

async function nextHint() {
  const apiKey = getStoredApiKey();
  const betaAccessKey = getStoredBetaAccessKey();
  const betaAccessAuth = getBetaAccessAuth();

  if (!betaAccessReady || !betaAccessKey) {
    appendChat("Enter your beta access key first, then continue.", { lineClass: "chat-wrong-reply" });
    return;
  }

  if (!apiReady || !apiKey) {
    appendChat("Register your API key first, then ask for hints.", { lineClass: "chat-wrong-reply" });
    return;
  }

  if (!debugState || !debugState.code) {
    appendChat("Run the code first");
    return;
  }

  statsState.hints += 1;
  setStatus("RUNNING", "running");
  appendChat("Asking for next hint...");
  debugState.debug_mode = debugMode;
  debugState.provider = apiProvider;

  try {
    const res = await fetch(buildApiUrl("/hint"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debug_state: debugState, debug_mode: debugMode, provider: apiProvider, api_key: apiKey, ...betaAccessAuth })
    });

    const data = await res.json();
    if (isBetaAccessError(data.error)) {
      handleBetaAccessFailure(data.error);
      return;
    }
    if ((data.error || "").toLowerCase().includes("api key")) {
      handleApiKeyFailure(data.error);
      return;
    }

    if (res.ok) {
      debugState = data.debug_state || debugState;
      noteHintDependency();
      const hintText = escapeHtml(data.message || "Hint received.").replace(/\n/g, "<br>");
      appendChat(`<span class="chat-hint-icon">💡</span> <span class="chat-hint-text">${hintText}</span>`, {
        html: true,
        lineClass: "chat-hint-reply"
      });
      updateProgress(statsState.progress + 8, "Hint received. Use it to move closer to the fix.");
      setStatus("OUTPUT", "output");
      return;
    }

    appendChat(data.error || "Error", { lineClass: "chat-wrong-reply" });
    noteWrongTurn();
    updateProgress(statsState.progress - 8, "Oops, that hint request did not land. Try again.");
    setStatus("ERROR", "error");
  } catch (error) {
    if ((error.message || "").toLowerCase().includes("api key")) {
      handleApiKeyFailure(error.message);
      return;
    }

    appendChat(error.message || "Connection error");
    noteWrongTurn();
    updateProgress(statsState.progress - 8, "Oops, the hint request failed. Try again.");
    setStatus("ERROR", "error");
  }
}

async function markDone() {
  const apiKey = getStoredApiKey();
  const betaAccessKey = getStoredBetaAccessKey();
  const betaAccessAuth = getBetaAccessAuth();

  if (!betaAccessReady || !betaAccessKey) {
    appendChat("Enter your beta access key first, then continue.", { lineClass: "chat-wrong-reply" });
    return;
  }

  if (!apiReady || !apiKey) {
    appendChat("Register your API key first, then finish the session.", { lineClass: "chat-wrong-reply" });
    return;
  }

  if (!debugState || !debugState.code) {
    appendChat("Run the code first");
    return;
  }

  setStatus("RUNNING", "running");
  debugState.debug_mode = debugMode;
  debugState.provider = apiProvider;

  try {
    const res = await fetch(buildApiUrl("/done"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debug_state: debugState, debug_mode: debugMode, provider: apiProvider, api_key: apiKey, ...betaAccessAuth })
    });

    const data = await res.json();
    if (isBetaAccessError(data.error)) {
      handleBetaAccessFailure(data.error);
      return;
    }
    if ((data.error || "").toLowerCase().includes("api key")) {
      handleApiKeyFailure(data.error);
      return;
    }

    appendChat(data.message || DONE_MESSAGE);
    completeActiveRun();
    updateProgress(100, "Session complete. Nice work debugging that one.");
    setStatus("DONE", "done");
    resetSessionState();
  } catch (error) {
    if ((error.message || "").toLowerCase().includes("api key")) {
      handleApiKeyFailure(error.message);
      return;
    }

    appendChat(error.message || "Connection error");
    noteWrongTurn();
    updateProgress(statsState.progress - 8, "Oops, the finish request failed. Try again.");
    setStatus("ERROR", "error");
  }
}

// INIT
initTypewriter();
startReleaseTimer();
syncHeroLogo();
apiProvider = getStoredProvider();
renderProviderSelector();
setCoachButtons(false);
setMode("debug");
setBetaGate(false, "⚠ Enter your beta access key to unlock this beta build.");
setApiGate(false);
updateStatsUI();
renderFixResults();
syncAdvancedStatsUI();
document.getElementById("thoughtInput").addEventListener("input", autoGrowThoughtInput);
autoGrowThoughtInput();
document.getElementById("betaAccessInput").addEventListener("input", syncBetaAccessInputMask);
document.getElementById("betaAccessInput").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  submitBetaAccess();
});
document.getElementById("codeInput").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !event.shiftKey) return;
  event.preventDefault();
  sendCode();
});
document.getElementById("thoughtInput").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !event.shiftKey) return;
  event.preventDefault();
  submitThought();
});
syncApiStatus();
syncBetaAccess();
document.getElementById("apiProviderGrid").addEventListener("click", (event) => {
  const option = event.target.closest(".api-provider-option");
  if (!option) return;
  setProvider(option.dataset.provider);
});
document.querySelectorAll(".debug-mode-option").forEach((button) => {
  button.addEventListener("click", () => setDebugMode(button.dataset.debugMode));
});
document.getElementById("toggleAdvancedStatsBtn").addEventListener("click", toggleAdvancedStats);
document.getElementById("downloadStatsBtn").addEventListener("click", downloadStats);
document.getElementById("downloadAdvancedStatsBtn").addEventListener("click", downloadAdvancedStats);
document.getElementById("resetStatsBtn").addEventListener("click", resetAllStats);
document.getElementById("copyFixedCodeBtn").addEventListener("click", async () => {
  if (!fixState.fixedCode) return;
  const copyBtn = document.getElementById("copyFixedCodeBtn");
  await navigator.clipboard.writeText(fixState.fixedCode);
  copyBtn.classList.add("is-copied");
  copyBtn.setAttribute("title", "Copied");
  setTimeout(() => {
    copyBtn.classList.remove("is-copied");
    copyBtn.setAttribute("title", "Copy code");
  }, 1400);
});


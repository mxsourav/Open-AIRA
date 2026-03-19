// ===== TYPEWRITER =====
function initTypewriter() {
  const target = document.getElementById("status-text");
  const phrases = [
    "Online",
    "Available",
    "Debugging code",
    "Designing stuff",
    "Crafting projects",
    "Pentesting",
    "Always Ready",
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
document.getElementById("themeBtn").onclick = () => {
  const html = document.documentElement;
  const theme = html.getAttribute("data-theme");
  html.setAttribute("data-theme", theme === "dark" ? "light" : "dark");
};

// ===== STATE =====
let mode = "debug";
let debugState = null;
let apiReady = false;

const DONE_MESSAGE = "Yoo Thats My Boy You Did It";
const FOUND_MESSAGE = "Good Job you found the bug now try to debug it.";

const fixState = {
  fixedCode: "",
  changeLog: []
};

const statsState = {
  runs: 0,
  thoughts: 0,
  hints: 0,
  wrongTurns: 0,
  bugReads: 0,
  progress: 0,
  bestProgress: 0,
  note: "Start a debug run and the tracker will wake up.",
  lastDelta: 0,
};

const THOUGHT_INPUT_MIN_HEIGHT = 42;
const THOUGHT_INPUT_MAX_LINES = 12;
const APP_CONFIG = window.CODESENTINEL_CONFIG || {};
const API_BASE_URL = String(APP_CONFIG.API_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
const API_KEY_STORAGE_KEY = "codesentinel_user_api_key";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function autoGrowThoughtInput() {
  const thoughtInput = document.getElementById("thoughtInput");
  if (!thoughtInput) return;

  const styles = window.getComputedStyle(thoughtInput);
  const lineHeight = parseFloat(styles.lineHeight) || 18;
  const paddingTop = parseFloat(styles.paddingTop) || 0;
  const paddingBottom = parseFloat(styles.paddingBottom) || 0;
  const borderTop = parseFloat(styles.borderTopWidth) || 0;
  const borderBottom = parseFloat(styles.borderBottomWidth) || 0;
  const maxVisibleHeight = Math.ceil(
    paddingTop + paddingBottom + borderTop + borderBottom + lineHeight * THOUGHT_INPUT_MAX_LINES
  );
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

function buildApiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function getStoredApiKey() {
  return sessionStorage.getItem(API_KEY_STORAGE_KEY) || "";
}

function storeApiKey(value) {
  sessionStorage.setItem(API_KEY_STORAGE_KEY, value);
}

function clearStoredApiKey() {
  sessionStorage.removeItem(API_KEY_STORAGE_KEY);
}

function handleApiKeyFailure(message) {
  clearStoredApiKey();
  debugState = null;
  setCoachButtons(false);
  setApiGate(false, message || "API key check failed. Enter your key again.");
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
  };
}

function setApiGate(ready, message = "") {
  apiReady = ready;

  const widget = document.getElementById("codesentinel");
  const status = document.getElementById("apiStatusText");
  const submitBtn = document.getElementById("apiSubmitBtn");
  const removeBtn = document.getElementById("apiRemoveBtn");
  const controls = [
    document.getElementById("debugModeBtn"),
    document.getElementById("fixModeBtn"),
    document.getElementById("thoughtBtn"),
    document.getElementById("hintBtn"),
    document.getElementById("doneBtn"),
    document.getElementById("codeInput"),
    document.getElementById("thoughtInput")
  ];

  if (widget) {
    widget.classList.toggle("is-locked", !ready);
  }

  controls.forEach((el) => {
    if (!el) return;
    el.disabled = !ready;
  });

  if (submitBtn) {
    submitBtn.disabled = false;
  }

  if (removeBtn) {
    removeBtn.disabled = !ready;
  }

  if (status) {
    status.textContent = message || (ready ? "API key ready in this browser session. It is not stored on the server." : "API key required before start.");
    status.classList.toggle("is-ready", ready);
    status.classList.toggle("is-error", !ready && Boolean(message));
  }

  if (!ready) {
    setStatus("LOCKED", "error");
  } else {
    setStatus("IDLE", "idle");
  }
}

function syncApiStatus() {
  const storedKey = getStoredApiKey();
  setApiGate(
    Boolean(storedKey),
    storedKey
      ? "API key ready in this browser session. It is not stored on the server."
      : "API key required before start."
  );
}

async function submitApiKey() {
  const input = document.getElementById("apiKeyInput");
  const key = input.value.trim();

  if (!key) {
    setApiGate(false, "Paste your API key first, then hit submit.");
    return;
  }

  try {
    const res = await fetch(buildApiUrl("/api-key"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key })
    });
    const data = await res.json();

    if (!res.ok) {
      setApiGate(false, data.error || "API key submission failed.");
      return;
    }

    storeApiKey(key);
    input.value = "";
    setApiGate(true, data.message || "API key ready in this browser session. It is not stored on the server.");
  } catch (error) {
    setApiGate(false, "Backend not reachable. Start the server and submit your API key.");
  }
}

function removeApiKey() {
  clearStoredApiKey();
  document.getElementById("apiKeyInput").value = "";
  document.getElementById("chatBox").innerHTML = "> API key removed. Submit a new key to start again.";
  fixState.fixedCode = "";
  fixState.changeLog = [];
  renderFixResults();
  resetSessionState();
  setApiGate(false, "API key removed from this browser session.");
}

function clampProgress(value) {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function getProgressColor(value) {
  if (value <= 33.5) return "#ff2d37";
  if (value <= 66.5) return "#f5b400";
  return "#00ff88";
}

function updateStatsUI() {
  const els = getStatsElements();
  if (!els.panel) return;

  els.panel.style.display = mode === "debug" ? "block" : "none";
  els.runs.textContent = String(statsState.runs);
  els.thoughts.textContent = String(statsState.thoughts);
  els.hints.textContent = String(statsState.hints);
  els.wrongTurns.textContent = String(statsState.wrongTurns);
  els.bugReads.textContent = String(statsState.bugReads);
  els.progressText.textContent = `${Math.round(statsState.progress)}%`;
  els.bestProgress.textContent = `${Math.round(statsState.bestProgress)}%`;
  els.note.textContent = statsState.note;

  const hasStats = statsState.runs > 0 || statsState.thoughts > 0 || statsState.hints > 0 || statsState.wrongTurns > 0 || statsState.bugReads > 0 || statsState.progress > 0 || statsState.bestProgress > 0;
  if (els.downloadBtn) {
    els.downloadBtn.style.display = hasStats ? "inline-flex" : "none";
  }

  const progressColor = getProgressColor(statsState.progress);
  els.progressFill.style.width = `${statsState.progress}%`;
  els.progressFill.style.background = `linear-gradient(90deg, ${progressColor}, ${progressColor})`;
  els.progressFill.style.boxShadow = `0 0 18px ${progressColor}`;
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
  statsState.progress = 0;
  statsState.bestProgress = 0;
  statsState.lastDelta = 0;
  statsState.note = "Stats reset. Start a fresh debug run.";
  updateStatsUI();
}

function setAlreadyCleanStats(message) {
  statsState.runs = 0;
  statsState.thoughts = 0;
  statsState.hints = 0;
  statsState.wrongTurns = 0;
  statsState.bugReads = 0;
  statsState.progress = 100;
  statsState.bestProgress = 100;
  statsState.lastDelta = 0;
  statsState.note = message || "Code already looks clean.";
  updateStatsUI();
}

function downloadStats() {
  const lines = [
    "CodeSentinel Stats Export",
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

  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "codesentinel-stats.txt";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
  appendChat('<span class="chat-help">2. Click <span class="chat-help-btn">Run</span> to start debugging.</span>', { html: true });
  appendChat('<span class="chat-help">3. Use <span class="chat-help-btn">Send Thought</span> to share your bug guess.</span>', { html: true });
  appendChat('<span class="chat-help">4. Use <span class="chat-help-btn">Next Hint</span> if you want another clue.</span>', { html: true });
  appendChat('<span class="chat-help">5. Use <span class="chat-help-btn">Fix</span> mode for direct corrected code.</span>', { html: true });
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

  if (handleLocalCommand(code)) return;

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
    appendChat("Processing...");
    statsState.runs += 1;
    updateProgress(Math.max(statsState.progress, 8), "Debug run started. Read the code slowly.");
  }

  try {
    const res = await fetch(buildApiUrl("/debug"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, mode, api_key: apiKey })
    });

    const data = await res.json();
    if (handleServerCommand(data)) return;

    if (!res.ok) {
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
        statsState.wrongTurns += 1;
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
      last_thought: ""
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
      statsState.wrongTurns += 1;
      updateProgress(statsState.progress - 10, "Oops, the request failed. Try again.");
    }

    setStatus("ERROR", "error");
  }
}

async function submitThought() {
  const thought = document.getElementById("thoughtInput").value.trim();
  const apiKey = getStoredApiKey();

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
  appendChat(`My thought: ${thought}`);
  document.getElementById("thoughtInput").value = "";
  autoGrowThoughtInput();
  setStatus("RUNNING", "running");

  try {
    const res = await fetch(buildApiUrl("/submit-thought"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debug_state: debugState, thought, api_key: apiKey })
    });

    const data = await res.json();
    if ((data.error || "").toLowerCase().includes("api key")) {
      handleApiKeyFailure(data.error);
      return;
    }

    const replyClass = data.thought_state === "wrong" || data.thought_state === "wrong_fix" ? "chat-wrong-reply" : undefined;
    appendChat(data.message || data.error || "Error", { lineClass: replyClass });

    if (data.done) {
      statsState.bugReads += 1;
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
      statsState.wrongTurns += 1;
      updateProgress(statsState.progress - 14, "Oops, wrong catch. Try a different part of the code.");
    }

    setStatus(res.ok ? "OUTPUT" : "ERROR", res.ok ? "output" : "error");
  } catch (error) {
    if ((error.message || "").toLowerCase().includes("api key")) {
      handleApiKeyFailure(error.message);
      return;
    }

    appendChat(error.message || "Connection error", { lineClass: "chat-wrong-reply" });
    statsState.wrongTurns += 1;
    updateProgress(statsState.progress - 10, "Oops, the request failed. Try again.");
    setStatus("ERROR", "error");
  }
}

async function nextHint() {
  const apiKey = getStoredApiKey();

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

  try {
    const res = await fetch(buildApiUrl("/hint"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debug_state: debugState, api_key: apiKey })
    });

    const data = await res.json();
    if ((data.error || "").toLowerCase().includes("api key")) {
      handleApiKeyFailure(data.error);
      return;
    }

    if (res.ok) {
      debugState = data.debug_state || debugState;
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
    statsState.wrongTurns += 1;
    updateProgress(statsState.progress - 8, "Oops, that hint request did not land. Try again.");
    setStatus("ERROR", "error");
  } catch (error) {
    if ((error.message || "").toLowerCase().includes("api key")) {
      handleApiKeyFailure(error.message);
      return;
    }

    appendChat(error.message || "Connection error");
    statsState.wrongTurns += 1;
    updateProgress(statsState.progress - 8, "Oops, the hint request failed. Try again.");
    setStatus("ERROR", "error");
  }
}

async function markDone() {
  const apiKey = getStoredApiKey();

  if (!apiReady || !apiKey) {
    appendChat("Register your API key first, then finish the session.", { lineClass: "chat-wrong-reply" });
    return;
  }

  if (!debugState || !debugState.code) {
    appendChat("Run the code first");
    return;
  }

  setStatus("RUNNING", "running");

  try {
    const res = await fetch(buildApiUrl("/done"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debug_state: debugState, api_key: apiKey })
    });

    const data = await res.json();
    if ((data.error || "").toLowerCase().includes("api key")) {
      handleApiKeyFailure(data.error);
      return;
    }

    appendChat(data.message || DONE_MESSAGE);
    updateProgress(100, "Session complete. Nice work debugging that one.");
    setStatus("DONE", "done");
    resetSessionState();
  } catch (error) {
    if ((error.message || "").toLowerCase().includes("api key")) {
      handleApiKeyFailure(error.message);
      return;
    }

    appendChat(error.message || "Connection error");
    statsState.wrongTurns += 1;
    updateProgress(statsState.progress - 8, "Oops, the finish request failed. Try again.");
    setStatus("ERROR", "error");
  }
}

// INIT
initTypewriter();
setCoachButtons(false);
setMode("debug");
setApiGate(false, "API key required before start.");
updateStatsUI();
renderFixResults();
document.getElementById("thoughtInput").addEventListener("input", autoGrowThoughtInput);
autoGrowThoughtInput();
syncApiStatus();
document.getElementById("downloadStatsBtn").addEventListener("click", downloadStats);
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


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

// ===== DEBUG =====
let mode = "debug";
let sessionId = "";

function setMode(m) {
  mode = m;
  const modeLabel = document.getElementById("modeLabel");
  modeLabel.innerText = m.toUpperCase();
  modeLabel.classList.remove("mode-debug", "mode-fix", "chip-pulse");
  modeLabel.classList.add(m === "debug" ? "mode-debug" : "mode-fix", "chip-pulse");

  const debugBtn = document.getElementById("debugModeBtn");
  const fixBtn = document.getElementById("fixModeBtn");

  if (m === "debug") {
    debugBtn.classList.remove("btn-ghost");
    fixBtn.classList.add("btn-ghost");
  } else {
    fixBtn.classList.remove("btn-ghost");
    debugBtn.classList.add("btn-ghost");
  }
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

function appendChat(text) {
  const box = document.getElementById("chatBox");
  box.innerHTML += `<br>&gt; ${String(text).replace(/\n/g, "<br>")}`;
  box.scrollTop = box.scrollHeight;
}

function clearChat() {
  document.getElementById("chatBox").innerHTML = "> cleared";
  document.getElementById("thoughtInput").value = "";
  sessionId = "";
  setCoachButtons(false);
  setStatus("IDLE", "idle");
}

function showHelp() {
  appendChat("How to use CodeSentinel:");
  appendChat("1. Paste broken code in the input box.");
  appendChat("2. Click Run to start debugging.");
  appendChat("3. Use Send Thought to share your bug guess.");
  appendChat("4. Use Next Hint if you want another clue.");
  appendChat("5. Use Fix mode if you want the corrected code directly.");
  appendChat("Commands: /help, clear, clr");
}

async function sendCode() {
  const code = document.getElementById("codeInput").value.trim();
  const command = code.toLowerCase();

  if (!code) {
    appendChat("No code entered");
    return;
  }

  if (["clear", "clr"].includes(command)) {
    clearChat();
    document.getElementById("codeInput").value = "";
    return;
  }

  if (command === "/help") {
    showHelp();
    setStatus("IDLE", "idle");
    return;
  }

  setCoachButtons(false);
  setStatus("RUNNING", "running");
  appendChat("Processing...");

  try {
    const res = await fetch("http://127.0.0.1:5000/debug", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, mode })
    });

    const data = await res.json();

    if (!res.ok) {
      appendChat(data.error || "Error");
      setStatus("ERROR", "error");
      return;
    }

    if (mode === "fix") {
      sessionId = "";
      document.getElementById("thoughtInput").value = "";
      appendChat(data.message || "Fixed code ready");
      setStatus("OUTPUT", "output");
      return;
    }

    sessionId = data.session_id;
    setCoachButtons(true);
    appendChat(data.message || "Where do you think the problem is?");
    setStatus("OUTPUT", "output");
  } catch (error) {
    appendChat(error.message || "Connection error");
    setStatus("ERROR", "error");
  }
}

async function submitThought() {
  const thought = document.getElementById("thoughtInput").value.trim();

  if (!sessionId) {
    appendChat("Run the code first");
    return;
  }

  if (!thought) {
    appendChat("Write where you think the problem is first");
    return;
  }

  appendChat(`My thought: ${thought}`);
  setStatus("RUNNING", "running");

  try {
    const res = await fetch("http://127.0.0.1:5000/submit-thought", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, thought })
    });

    const data = await res.json();
    appendChat(data.message || data.error || "Error");
    setStatus(res.ok ? "OUTPUT" : "ERROR", res.ok ? "output" : "error");
  } catch (error) {
    appendChat(error.message || "Connection error");
    setStatus("ERROR", "error");
  }
}

async function nextHint() {
  if (!sessionId) {
    appendChat("Run the code first");
    return;
  }

  setStatus("RUNNING", "running");
  appendChat("Asking for next hint...");

  try {
    const res = await fetch("http://127.0.0.1:5000/hint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId })
    });

    const data = await res.json();
    appendChat(data.message || data.error || "Error");
    setStatus(res.ok ? "OUTPUT" : "ERROR", res.ok ? "output" : "error");
  } catch (error) {
    appendChat(error.message || "Connection error");
    setStatus("ERROR", "error");
  }
}

async function markDone() {
  if (!sessionId) {
    appendChat("Run the code first");
    return;
  }

  setStatus("RUNNING", "running");

  try {
    const res = await fetch("http://127.0.0.1:5000/done", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId })
    });

    const data = await res.json();
    appendChat(data.message || "Yoo Thats My Boy You Did It");
    setStatus("DONE", "done");
    setCoachButtons(false);
    sessionId = "";
    document.getElementById("thoughtInput").value = "";
  } catch (error) {
    appendChat(error.message || "Connection error");
    setStatus("ERROR", "error");
  }
}

// INIT
initTypewriter();
setCoachButtons(false);
setMode("debug");
setStatus("IDLE", "idle");


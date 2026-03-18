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

  let i = 0, j = 0, current = "", isDeleting = false;

  function loop() {
    current = phrases[i];

    if (isDeleting) {
      j--;
    } else {
      j++;
    }

    target.textContent = current.substring(0, j);

    if (!isDeleting && j === current.length) {
      isDeleting = true;
      setTimeout(loop, 1000);
      return;
    }

    if (isDeleting && j === 0) {
      isDeleting = false;
      i = (i + 1) % phrases.length;
    }

    setTimeout(loop, isDeleting ? 40 : 80);
  }

  loop();
}

// ===== THEME (UNCHANGED STYLE) =====
document.getElementById("themeBtn").onclick = () => {
  const html = document.documentElement;
  const theme = html.getAttribute("data-theme");
  html.setAttribute("data-theme", theme === "dark" ? "light" : "dark");
};

// ===== DEBUG =====
let mode = "debug";

function setMode(m) {
  mode = m;
  document.getElementById("modeLabel").innerText = m.toUpperCase();
}

function appendChat(t) {
  const box = document.getElementById("chatBox");
  box.innerHTML += "<br>> " + t;
}

function clearChat() {
  document.getElementById("chatBox").innerHTML = "> cleared";
}

async function sendCode() {
  const code = document.getElementById("codeInput").value;

  if (!code) return appendChat("No code entered");

  appendChat("Processing...");

  const res = await fetch("http://127.0.0.1:5000/debug", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });

  const data = await res.json();

  appendChat(data.ai_response || "Error");
}

// INIT
initTypewriter();
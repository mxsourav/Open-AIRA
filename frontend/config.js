window.CODESENTINEL_CONFIG = Object.assign(
  {
    API_BASE_URL:
      window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
        ? "http://127.0.0.1:5000"
        : "https://codesentinel-v-3-0.onrender.com",
    API_KEY_MODE: "browser-session"
  },
  window.CODESENTINEL_CONFIG || {}
);

"use strict";

const API = "https://api.github.com";
const REPO = "editelidhu";
const PORT = 8765;
const KEY = "ee-start-token";
const MAX_WAIT_MS = 10 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token = localStorage.getItem(KEY) || "";
let codespace = null;
let cancelled = false;

function say(text, spinning = false) {
  const parts = [document.createTextNode(text)];
  if (spinning) {
    const s = document.createElement("span");
    s.className = "spin";
    parts.unshift(s);
  }
  $("status").replaceChildren(...parts);
}

function view({ setup = false, actions = false, retry = false } = {}) {
  $("setup").hidden = !setup;
  $("actions").hidden = !actions;
  $("retry").hidden = !retry;
  $("forget-wrap").hidden = setup || !token;
}

class Stop extends Error {}

async function gh(path, method = "GET") {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Stop("Can't reach GitHub. Check the internet connection.");
  }
  if (res.status === 401) {
    token = "";
    localStorage.removeItem(KEY);
    view({ setup: true });
    throw new Stop("GitHub rejected the token (expired or missing the codespace permission). Paste a new one.");
  }
  if (res.status === 402) throw new Stop("Your free Codespaces hours or storage for this month are used up.");
  if (res.status === 409 || res.status === 304) return null;
  if (!res.ok) throw new Stop(`GitHub returned an error (${res.status}). Try again in a minute.`);
  return res.json();
}

async function findCodespace() {
  const { codespaces = [] } = await gh("/user/codespaces?per_page=100");
  const mine = codespaces
    .filter((c) => c.repository && c.repository.name.toLowerCase() === REPO)
    .sort((a, b) => String(b.last_used_at).localeCompare(String(a.last_used_at)));
  if (!mine.length) throw new Stop("No EditElidhu codespace found on this GitHub account.");
  return mine[0];
}

const appUrl = () => `https://${codespace.name}-${PORT}.app.github.dev/`;

// A cross-origin image only loads once the app itself answers on the public port.
function appReady() {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ""; resolve(false); }, 8000);
    img.onload = () => { clearTimeout(timer); resolve(true); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = `${appUrl()}static/icons/favicon-32.png?t=${Date.now()}`;
  });
}

function showRunning() {
  $("open").href = appUrl();
  $("open").hidden = false;
  say("EditElidhu is running.");
  view({ actions: true });
}

async function start() {
  cancelled = false;
  $("editor").hidden = true;
  view({ actions: false });
  say("Checking your codespace…", true);
  codespace = await findCodespace();
  if (codespace.state === "Available" && (await appReady())) return showRunning();

  $("open").href = appUrl();
  $("actions").hidden = false;
  $("open").hidden = true;
  const t0 = Date.now();
  let lastStart = 0;
  while (!cancelled) {
    const secs = Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > MAX_WAIT_MS) {
      throw new Stop("EditElidhu didn't answer. Open the codespace at github.com/codespaces, check /tmp/editelidhu.log, and make sure port 8765 is Public.");
    }
    if (codespace.state === "Shutdown" && Date.now() - lastStart > 15000) {
      lastStart = Date.now();
      await gh(`/user/codespaces/${codespace.name}/start`, "POST");
    }
    if (codespace.state === "Available") {
      if (secs < 90) {
        say(`Starting EditElidhu… ${secs}s`, true);
      } else {
        say(`Still waiting for the app (${secs}s). If it never opens, open the codespace editor and run ./run.sh in its terminal.`, true);
        $("editor").href = codespace.web_url;
        $("editor").hidden = false;
      }
      if (await appReady()) {
        if (cancelled) return;
        say("Opening EditElidhu…", true);
        location.replace(appUrl());
        return;
      }
    } else {
      say(`Starting the codespace… ${secs}s`, true);
    }
    await sleep(3000);
    codespace = (await gh(`/user/codespaces/${codespace.name}`)) || codespace;
  }
}

async function stop() {
  cancelled = true;
  view();
  say("Stopping the codespace…", true);
  codespace = codespace || (await findCodespace());
  await gh(`/user/codespaces/${codespace.name}/stop`, "POST");
  say("Stopped. No Codespaces hours are being used now.");
  $("retry").textContent = "Start again";
  view({ retry: true });
}

function run(task) {
  task().catch((err) => {
    if (!(err instanceof Stop)) console.error(err);
    say(err instanceof Stop ? err.message : "Something went wrong. Try again.");
    $("retry").textContent = "Try again";
    view({ setup: !token, retry: !!token });
  });
}

$("setup").addEventListener("submit", (e) => {
  e.preventDefault();
  token = $("token").value.trim();
  if (!token) return;
  localStorage.setItem(KEY, token);
  $("token").value = "";
  run(start);
});
$("stop").addEventListener("click", () => run(stop));
$("retry").addEventListener("click", () => run(start));
$("forget").addEventListener("click", (e) => {
  e.preventDefault();
  token = "";
  localStorage.removeItem(KEY);
  say("Paste a GitHub token to connect this phone.");
  view({ setup: true });
});

if (token) {
  run(start);
} else {
  say("One-time setup: paste a GitHub token to connect this phone.");
  view({ setup: true });
}

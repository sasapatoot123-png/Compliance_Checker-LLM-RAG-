const $ = (id) => document.getElementById(id);

const LABEL = { COMPLIANT: "Compliant", PARTIAL: "Partial", NOT_COMPLIANT: "Not compliant", UNKNOWN: "Unknown" };
const ORDER = ["NOT_COMPLIANT", "PARTIAL", "UNKNOWN", "COMPLIANT"];

let pdfReady = false;
let csvReady = false;
let running = false;
let runId = null;
let since = 0;
let all = [];
let filter = "ALL";
let timer = null;

function showMessage(text, isError) {
  const el = $("message");
  el.textContent = text || "";
  el.hidden = !text;
  el.classList.toggle("error", !!isError);
}

function showOutput(which) {
  for (const id of ["empty", "loading", "result"]) $(id).hidden = id !== which;
  $("loading").classList.remove("is-done");
  $("loadTitle").textContent = "Checking requirements…";
}

// Finish state: the happy robot stays on top, the report appears below it.
function showDone() {
  $("empty").hidden = true;
  $("loading").hidden = false;
  $("loading").classList.add("is-done");
  $("loadTitle").textContent = "Report ready";
  $("progText").textContent = all.length + " requirements checked";
  $("result").hidden = false;
}

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const REDUCE = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

function skel(id) {
  const e = $(id);
  e._n = (e._n || 0) + 1;
  e.textContent = "-";
  e.classList.add("sk");
}

function setNum(id, value) {
  const e = $(id), to = Number(value), n = (e._n = (e._n || 0) + 1);
  e.classList.remove("sk");
  if (REDUCE || !isFinite(to)) { e.textContent = value; return; }
  const t0 = performance.now();
  (function f(now) {
    if (e._n !== n) return;
    const p = Math.min(1, (now - t0) / 800);
    e.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(f);
  })(t0);
}

function setSteps(done) {
  [...$("steps").children].forEach((li, i) => {
    li.classList.toggle("done", i < done);
    li.classList.toggle("active", i === done);
  });
}

function setRunning(on) {
  running = on;
  $("runBtn").disabled = on;
  $("pdfFile").disabled = on;
  $("csvFile").disabled = on;
}

function setPdf(d) {
  pdfReady = true;
  $("fileName").textContent = d.name;
  $("fileHint").textContent = "Ready — run the compliance check";
  $("fileHint").classList.add("ok");
  $("fileName").closest(".filecard").classList.add("ready");
  setNum("nPages", d.pages);
  setNum("nChunks", d.chunks);
}

function setCsv(d) {
  csvReady = true;
  $("csvName").textContent = d.name;
  $("csvHint").textContent = d.count + " requirements loaded";
  $("csvHint").classList.add("ok");
  setNum("nReqs", d.count);
}

async function uploadPdf(file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return showMessage("Please choose a PDF file.", true);
  }

  pdfReady = false;
  showMessage("");
  $("fileName").textContent = file.name;
  $("fileHint").textContent = "Reading and indexing your PDF…";
  $("fileHint").classList.remove("ok");
  $("fileName").closest(".filecard").classList.remove("ready");
  $("fileName").closest(".filecard").classList.add("busy");
  skel("nPages");
  skel("nChunks");

  const form = new FormData();
  form.append("pdf", file);

  try {
    setPdf(await api("/api/upload", { method: "POST", body: form }));
  } catch (err) {
    $("fileName").textContent = "No file selected";
    $("fileHint").textContent = "Upload the company PDF to get started";
    $("fileHint").classList.remove("ok");
    for (const id of ["nPages", "nChunks"]) { $(id).classList.remove("sk"); }
    showMessage(err.message, true);
  } finally {
    $("fileName").closest(".filecard").classList.remove("busy");
    $("pdfFile").value = "";
  }
}

async function uploadCsv(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".csv")) return showMessage("Please choose a CSV file.", true);

  csvReady = false;
  showMessage("");
  $("csvName").textContent = file.name;
  $("csvHint").textContent = "Reading requirements…";
  $("csvHint").classList.remove("ok");
  $("csvRow").classList.add("busy");
  skel("nReqs");

  const form = new FormData();
  form.append("csv", file);

  try {
    setCsv(await api("/api/upload_csv", { method: "POST", body: form }));
  } catch (err) {
    $("csvName").textContent = "No ISO 27001 CSV selected";
    $("csvHint").textContent = "Choose the requirements file";
    $("csvHint").classList.remove("ok");
    $("nReqs").classList.remove("sk");
    showMessage(err.message, true);
  } finally {
    $("csvRow").classList.remove("busy");
    $("csvFile").value = "";
  }
}

$("pdfFile").addEventListener("change", (e) => uploadPdf(e.target.files[0]));
$("csvFile").addEventListener("change", (e) => uploadCsv(e.target.files[0]));

const drop = $("drop");
["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => uploadPdf(e.dataTransfer.files[0]));

function counts(list) {
  const c = { COMPLIANT: 0, PARTIAL: 0, NOT_COMPLIANT: 0, UNKNOWN: 0 };
  for (const r of list) c[r.Verdict] = (c[r.Verdict] || 0) + 1;
  return c;
}

function pct(list) {
  if (!list.length) return 0;
  const pts = { COMPLIANT: 1, PARTIAL: 0.5, NOT_COMPLIANT: 0, UNKNOWN: 0 };
  return (100 * list.reduce((s, r) => s + (pts[r.Verdict] || 0), 0)) / list.length;
}

function updateProgress(s) {
  const total = s.total || 1;
  $("barFill").style.width = Math.round((100 * s.done) / total) + "%";
  $("progText").textContent = s.done + " / " + s.total + (s.current ? " — " + s.current : "");
  const c = counts(all);
  $("liveOk").textContent = "Compliant " + c.COMPLIANT;
  $("livePart").textContent = "Partial " + c.PARTIAL;
  $("liveBad").textContent = "Not compliant " + (c.NOT_COMPLIANT + c.UNKNOWN);
}

function card(r) {
  const box = el("div", "req " + r.Verdict);
  const top = el("div", "req-top");
  top.append(el("span", "req-id", r.ID), el("span", "req-title", r.Requirement),
             el("span", "vb " + r.Verdict, LABEL[r.Verdict] || r.Verdict));
  box.append(top, el("p", "req-reason", r.Reason));

  if (r.Evidence) {
    const text = r.Evidence.length > 600 ? r.Evidence.slice(0, 600) + "…" : r.Evidence;
    box.append(el("div", "req-sub", "Evidence (page " + r.Page + ")"), el("p", "req-ev", text));
  }
  if (r.Recommendation) {
    box.append(el("div", "req-sub", "Recommended fix"), el("pre", "req-fix", r.Recommendation));
  }
  return box;
}

function renderList() {
  const list = $("reqList");
  list.replaceChildren();
  const rows = all
    .filter((r) => filter === "ALL" || r.Verdict === filter)
    .sort((a, b) => ORDER.indexOf(a.Verdict) - ORDER.indexOf(b.Verdict));
  if (!rows.length) return list.append(el("div", "none", "No requirements in this category."));
  rows.forEach((r, i) => {
    const c = card(r);
    c.style.setProperty("--d", Math.min(i * 55, 550) + "ms");
    list.append(c);
  });
}

function renderResult() {
  const c = counts(all);
  $("rPct").textContent = pct(all).toFixed(1) + "%";
  $("cOk").textContent = c.COMPLIANT;
  $("cPart").textContent = c.PARTIAL;
  $("cBad").textContent = c.NOT_COMPLIANT;
  $("cUnk").textContent = c.UNKNOWN;
  $("cUnkBox").hidden = !c.UNKNOWN;
  renderList();
  showDone();
}

function stopPolling() {
  clearTimeout(timer);
  timer = null;
}

async function tick() {
  try {
    const s = await api("/api/status?since=" + since);
    if (s.run_id !== runId) return;
    all.push(...s.results);
    since += s.results.length;
    updateProgress(s);

    if (s.state === "running") {
      timer = setTimeout(tick, 1200);
      return;
    }

    setRunning(false);
    if (s.state === "error") showMessage(s.error || "The check failed.", true);
    if (all.length) {
      setSteps(4);
      $("barFill").style.width = "100%";
      $("loading").classList.add("is-done");
      $("loadTitle").textContent = "Report ready";
      $("progText").textContent = all.length + " requirements checked";
      const id = runId;
      setTimeout(() => { if (runId === id && !running) renderResult(); }, REDUCE ? 0 : 650);
    } else showOutput("empty");
  } catch (err) {
    stopPolling();
    setRunning(false);
    showOutput(all.length ? "result" : "empty");
    showMessage(err.message, true);
  }
}

function beginPolling(id) {
  runId = id;
  since = 0;
  all = [];
  setRunning(true);
  showOutput("loading");
  setSteps(2);
  $("progText").textContent = "Starting…";
  $("barFill").style.width = "0%";
  tick();
}

async function run() {
  showMessage("");
  if (!pdfReady) return showMessage("Please upload the company PDF first.");
  if (!csvReady) return showMessage("Please choose the ISO 27001 requirements CSV.");

  const model = $("model").value.trim();
  try { localStorage.setItem("model_v2", model); } catch (e) {}

  try {
    const r = await api("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    beginPolling(r.run_id);
  } catch (err) {
    showMessage(err.message, true);
  }
}

$("runBtn").addEventListener("click", run);

$("filters").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  filter = b.dataset.f;
  for (const x of $("filters").children) x.classList.toggle("on", x === b);
  renderList();
});

$("clearBtn").addEventListener("click", async () => {
  stopPolling();
  runId = null;
  all = [];
  since = 0;
  filter = "ALL";
  for (const x of $("filters").children) x.classList.toggle("on", x.dataset.f === "ALL");
  setRunning(false);
  showMessage("");
  showOutput("empty");
  try { await api("/api/reset", { method: "POST" }); } catch (e) {}
});

$("theme").addEventListener("click", () => {
  const root = document.documentElement;
  const next = root.dataset.theme === "light" ? "dark" : "light";
  root.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch (e) {}
});

async function init() {
  try {
    const saved = localStorage.getItem("model_v2");
    if (saved) $("model").value = saved;
  } catch (e) {}

  try {
    const s = await api("/api/state");
    for (const m of s.models) {
      const o = document.createElement("option");
      o.value = m;
      $("models").append(o);
    }
    if (s.pdf) setPdf(s.pdf);
    if (s.csv) setCsv(s.csv);
    if (!s.ollama) showMessage("Ollama is not running. Start it with: ollama serve", true);
    if (s.job && s.job.state !== "idle" && s.job.state !== "cancelled") beginPolling(s.job.run_id);
  } catch (err) {
    showMessage(location.protocol === "file:"
      ? "Open the app through the server: run python server.py, then use the address it prints."
      : "Cannot reach the server. Start it with: python server.py", true);
  }
}

init();

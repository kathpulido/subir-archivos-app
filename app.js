"use strict";

const KEY = "subir-github.v1";
const MAX_FILE = 50 * 1024 * 1024; // límite por archivo (la base64 pesa ~33 % más en memoria)
const DEFAULTS = { user: "", repo: "", branch: "main", folder: "", token: "" };

/* ---------- utilidades puras (se prueban con node) ---------- */

function pad(n) { return String(n).padStart(2, "0"); }

function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function safeName(name) {
  const cleaned = String(name)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "archivo";
}

function uniqueName(fileName, index, d = new Date(), rand = Math.random().toString(36).slice(2, 5)) {
  return `${stamp(d)}-${index + 1}${rand}-${safeName(fileName)}`;
}

function categoryOf(file) {
  const t = file.type || "";
  const n = file.name || "";
  if (t.startsWith("video/") || /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(n)) return "videos";
  if (t.startsWith("image/") || /\.(jpe?g|png|heic|heif|gif|webp|bmp|tiff?)$/i.test(n)) return "fotos";
  if (t.startsWith("audio/") || /\.(m4a|mp3|wav|aac|ogg|flac|opus)$/i.test(n)) return "audios";
  return "documentos";
}

function monthFolder(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function repoDir(base, file, d = new Date()) {
  return [base, categoryOf(file), monthFolder(d)].filter(Boolean).join("/");
}

function tooBig(file) {
  return file.size > MAX_FILE;
}

function repoPath(folder, name) {
  return String(folder || "")
    .split("/").filter(Boolean)
    .concat(name)
    .map(encodeURIComponent)
    .join("/");
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

/* ---------- API de GitHub ---------- */

async function gh(cfg, path, opts = {}) {
  return fetch("https://api.github.com" + path, {
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: "Bearer " + cfg.token,
      ...(opts.headers || {}),
    },
  });
}

async function errText(r) {
  try {
    const j = await r.json();
    return `${r.status}: ${j.message || "error"}`;
  } catch {
    return String(r.status);
  }
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    fr.onerror = () => reject(fr.error || new Error("No se pudo leer el archivo"));
    fr.readAsDataURL(file);
  });
}

// Sube un archivo con la API de contenidos (PUT). Usa XHR para tener barra de progreso
// y arma el cuerpo como Blob para no duplicar en memoria la cadena base64.
async function putToRepo(cfg, file, name, dir, onProgress) {
  onProgress(0.05);
  const b64 = await toBase64(file);
  onProgress(0.3);
  const head = JSON.stringify({ message: "Subir " + name, ...(cfg.branch ? { branch: cfg.branch } : {}) });
  const body = new Blob([head.slice(0, -1), ',"content":"', b64, '"}'], { type: "application/json" });
  const url = `https://api.github.com/repos/${encodeURIComponent(cfg.user)}/${encodeURIComponent(cfg.repo)}/contents/${repoPath(dir, name)}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Authorization", "Bearer " + cfg.token);
    xhr.setRequestHeader("Accept", "application/vnd.github+json");
    xhr.setRequestHeader("X-GitHub-Api-Version", "2022-11-28");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(0.3 + 0.7 * (e.loaded / e.total)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        try { resolve(JSON.parse(xhr.responseText).content.html_url || ""); } catch { resolve(""); }
      } else {
        let m = String(xhr.status);
        try { m += ": " + JSON.parse(xhr.responseText).message; } catch {}
        reject(new Error(m));
      }
    };
    xhr.onerror = () => reject(new Error("Error de red al subir"));
    xhr.send(body);
  });
}

/* ---------- interfaz ---------- */

if (typeof document !== "undefined") {
  const $ = (s) => document.querySelector(s);
  const ids = ["user", "repo", "branch", "folder", "token"];
  let items = []; // { file, thumb, state, progress, status, cls, link, fillEl }
  let busy = false;

  function loadCfg() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
    catch { return { ...DEFAULTS }; }
  }
  function saveCfg(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} }
  function readForm() {
    const c = {};
    ids.forEach((id) => { c[id] = $("#" + id).value.trim(); });
    return c;
  }
  function fillForm(c) { ids.forEach((id) => { $("#" + id).value = c[id] || ""; }); }
  function say(text, kind) { const m = $("#msg"); m.textContent = text; m.className = kind || ""; }
  function needsConfig(c) { return !c.user || !c.repo || !c.token; }

  function icon(file) {
    const c = categoryOf(file);
    return c === "videos" ? "🎬" : c === "audios" ? "🎵" : "📄";
  }

  function render() {
    const ul = $("#list");
    ul.textContent = "";
    const base = readForm().folder;
    items.forEach((it) => {
      const li = document.createElement("li");
      li.className = "item";
      const th = document.createElement("div");
      th.className = "thumb";
      if (categoryOf(it.file) === "fotos" && it.file.type.startsWith("image/")) {
        const img = document.createElement("img");
        it.thumb = it.thumb || URL.createObjectURL(it.file);
        img.src = it.thumb; img.alt = "";
        th.appendChild(img);
      } else {
        th.textContent = icon(it.file);
      }
      const info = document.createElement("div");
      const nm = document.createElement("div"); nm.className = "name"; nm.textContent = it.file.name;
      const mt = document.createElement("div"); mt.className = "meta";
      mt.textContent = `${fmtSize(it.file.size)} · ${repoDir(base, it.file)}`;
      const bar = document.createElement("div"); bar.className = "bar";
      const fill = document.createElement("i"); fill.style.width = (it.progress || 0) * 100 + "%";
      bar.appendChild(fill);
      const st = document.createElement("div"); st.className = "status " + (it.cls || "");
      if (it.link) {
        const a = document.createElement("a");
        a.href = it.link; a.target = "_blank"; a.rel = "noopener";
        a.textContent = it.status || "Subido";
        st.appendChild(a);
      } else {
        st.textContent = it.status || (tooBig(it.file) ? "Supera el límite de " + fmtSize(MAX_FILE) : "");
        if (tooBig(it.file)) st.className = "status err";
      }
      info.append(nm, mt, bar, st);
      li.append(th, info);
      ul.appendChild(li);
      it.fillEl = fill;
    });
    $("#actions").classList.toggle("hidden", items.length === 0);
    $("#uploadBtn").disabled = busy || !items.some((i) => i.state !== "ok" && !tooBig(i.file));
    $("#clearBtn").disabled = busy;
  }

  function setProgress(it, p) {
    it.progress = p;
    if (it.fillEl) it.fillEl.style.width = p * 100 + "%";
  }

  async function uploadAll() {
    const cfg = readForm();
    if (needsConfig(cfg)) {
      $("#settings").open = true;
      say("Completa usuario, repositorio y token.", "err");
      return;
    }
    saveCfg(cfg);
    busy = true; render();
    let n = 0;
    for (const it of items) {
      if (it.state === "ok" || tooBig(it.file)) continue;
      n += 1;
      it.state = "up"; it.status = "Subiendo…"; it.cls = ""; setProgress(it, 0.02);
      render();
      const name = uniqueName(it.file.name, n - 1);
      try {
        it.link = await putToRepo(cfg, it.file, name, repoDir(cfg.folder, it.file), (p) => setProgress(it, p));
        it.state = "ok"; it.status = "Subido ✓"; it.cls = "ok"; setProgress(it, 1);
      } catch (e) {
        it.state = "err"; it.status = "Falló: " + (e && e.message ? e.message : e); it.cls = "err"; setProgress(it, 0);
      }
      render();
    }
    busy = false; render();
  }

  async function testConn() {
    const cfg = readForm();
    if (needsConfig(cfg)) { say("Completa usuario, repositorio y token.", "err"); return; }
    say("Probando…");
    try {
      const r = await gh(cfg, `/repos/${encodeURIComponent(cfg.user)}/${encodeURIComponent(cfg.repo)}`);
      if (!r.ok) { say("No se pudo acceder: " + (await errText(r)), "err"); return; }
      const j = await r.json();
      const canPush = j.permissions && j.permissions.push;
      say(canPush ? `Conectado a ${j.full_name} (${j.private ? "privado" : "público"}) ✓` : "Conectado, pero el token no tiene permiso de escritura.", canPush ? "ok" : "err");
    } catch (e) {
      say("Error de red: " + (e && e.message ? e.message : e), "err");
    }
  }

  $("#pickBtn").addEventListener("click", () => $("#picker").click());
  $("#picker").addEventListener("change", (e) => {
    Array.from(e.target.files).forEach((file) => items.push({ file, state: "new", progress: 0 }));
    e.target.value = "";
    render();
  });
  $("#uploadBtn").addEventListener("click", uploadAll);
  $("#clearBtn").addEventListener("click", () => {
    items.forEach((i) => { if (i.thumb) URL.revokeObjectURL(i.thumb); });
    items = []; render();
  });
  $("#saveBtn").addEventListener("click", () => {
    saveCfg(readForm());
    say("Configuración guardada.", "ok");
    render();
  });
  $("#testBtn").addEventListener("click", testConn);

  const cfg0 = loadCfg();
  fillForm(cfg0);
  if (needsConfig(cfg0)) $("#settings").open = true;
  render();

  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (!standalone) $("#installTip").classList.remove("hidden");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

if (typeof module !== "undefined") {
  module.exports = { stamp, safeName, uniqueName, categoryOf, monthFolder, repoDir, repoPath, tooBig, fmtSize, MAX_FILE };
}

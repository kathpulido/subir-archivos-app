"use strict";

const KEY = "subir-github.v1";
const SPLIT_AT = 15 * 1024 * 1024;   // más que esto se divide en partes (13,9 MB subió bien directo)
const PART_SIZE = 10 * 1024 * 1024;  // tamaño de cada parte
const MAX_FILE = 500 * 1024 * 1024;  // límite por archivo (GitHub recomienda repos < 1 GB)
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

function tooBig(file) { return file.size > MAX_FILE; }
function needsSplit(file) { return file.size > SPLIT_AT; }
function partsCount(size) { return Math.max(1, Math.ceil(size / PART_SIZE)); }
function partName(i) { return "parte" + String(i + 1).padStart(3, "0"); }

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

function textToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function buildManifest(file, total) {
  return {
    version: 1,
    originalName: file.name,
    type: file.type || "",
    size: file.size,
    partSize: PART_SIZE,
    parts: total,
    partFiles: Array.from({ length: total }, (_, i) => partName(i)),
    created: new Date().toISOString(),
  };
}

function buildReadme(file, total) {
  const finalName = String(file.name).replace(/"/g, "");
  const names = Array.from({ length: total }, (_, i) => partName(i));
  return [
    "ARCHIVO DIVIDIDO EN PARTES",
    "==========================",
    "",
    `Archivo original: ${file.name}`,
    `Tamaño exacto:    ${file.size} bytes (${fmtSize(file.size)})`,
    `Partes:           ${total} (${names[0]} ... ${names[total - 1]}), de hasta ${fmtSize(PART_SIZE)} cada una`,
    "",
    "Ninguna parte se puede abrir por separado: hay que unirlas todas, en orden.",
    "",
    "CÓMO UNIRLAS",
    "------------",
    "1) Descarga TODAS las partes (parte001, parte002, ...) a una misma carpeta.",
    "   Puedes descargar el repositorio completo (Code -> Download ZIP) o archivo por archivo.",
    "2) Abre una terminal dentro de esa carpeta y ejecuta el comando de tu sistema:",
    "",
    "Windows (Símbolo del sistema, cmd):",
    `  copy /b ${names.join("+")} "${finalName}"`,
    "",
    "Windows (alternativa corta, une en orden alfabético):",
    `  copy /b parte* "${finalName}"`,
    "",
    "Mac o Linux (Terminal):",
    `  cat parte* > "${finalName}"`,
    "",
    "3) Comprueba que el archivo final pese exactamente " + file.size + " bytes.",
    "",
    "SIN COMANDOS",
    "------------",
    "En la app «Subir a GitHub» usa la sección «Archivos divididos» -> Descargar:",
    "baja las partes, las une y te entrega el archivo completo (mejor desde un computador).",
    "",
  ].join("\n");
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

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    fr.onerror = () => reject(fr.error || new Error("No se pudo leer el archivo"));
    fr.readAsDataURL(blob);
  });
}

// PUT a la API de contenidos con progreso (XHR). El cuerpo se arma como Blob
// para no duplicar en memoria la cadena base64.
function putB64(cfg, b64, dir, name, onProgress) {
  const head = JSON.stringify({ message: "Subir " + dir + "/" + name, ...(cfg.branch ? { branch: cfg.branch } : {}) });
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
        let api = "";
        try { api = JSON.parse(xhr.responseText).message || ""; } catch {}
        const err = new Error(xhr.status + (api ? ": " + api : ""));
        err.status = xhr.status;
        err.apiMessage = api;
        reject(err);
      }
    };
    xhr.onerror = () => {
      const err = new Error("Error de red al subir");
      err.status = 0;
      reject(err);
    };
    xhr.send(body);
  });
}

async function putBlob(cfg, blob, name, dir, onProgress) {
  onProgress(0.05);
  const b64 = await toBase64(blob);
  onProgress(0.3);
  return putB64(cfg, b64, dir, name, onProgress);
}

function putText(cfg, text, name, dir) {
  return putB64(cfg, textToBase64(text), dir, name, () => {});
}

// Reintenta fallos de red, 409 (commit simultáneo) y errores 5xx.
async function withRetry(fn, tries = 3, wait = 800) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const s = e && e.status;
      const retryable = s === 0 || s === undefined || s === 409 || s >= 500;
      if (!retryable) throw e;
      await new Promise((r) => setTimeout(r, wait * (i + 1)));
    }
  }
  throw last;
}

// 422 con "sha" significa que ese archivo ya existe (subida anterior): se da por bueno.
function alreadyThere(e) {
  return !!(e && e.status === 422 && /sha/i.test(e.apiMessage || ""));
}

// Sube un archivo. Si es grande lo divide en partes dentro de una carpeta «<nombre>.partes».
// `st` guarda el avance para poder reanudar tras un fallo: { nextPart }.
async function uploadFile(cfg, file, name, dir, st, onProgress, onStatus, wait = 800) {
  if (!needsSplit(file)) {
    return withRetry(() => putBlob(cfg, file, name, dir, onProgress), 3, wait);
  }
  const total = partsCount(file.size);
  const folder = `${dir}/${name}.partes`;
  const put = async (fn) => { try { await withRetry(fn, 3, wait); } catch (e) { if (!alreadyThere(e)) throw e; } };
  for (; st.nextPart < total; st.nextPart++) {
    const i = st.nextPart;
    onStatus(`Subiendo parte ${i + 1} de ${total}…`);
    const blob = file.slice(i * PART_SIZE, Math.min(file.size, (i + 1) * PART_SIZE));
    await put(() => putBlob(cfg, blob, partName(i), folder, (p) => onProgress((i + p) / (total + 1))));
  }
  onStatus("Guardando índice e instrucciones…");
  await put(() => putText(cfg, JSON.stringify(buildManifest(file, total), null, 2), "manifest.json", folder));
  await put(() => putText(cfg, buildReadme(file, total), "LEEME-UNIR.txt", folder));
  onProgress(1);
  return `https://github.com/${cfg.user}/${cfg.repo}/tree/${cfg.branch || "main"}/${folder}`;
}

// Lista las carpetas «.partes» del repositorio (las que tienen manifest.json).
async function listSplits(cfg) {
  const branch = cfg.branch || "main";
  const r = await gh(cfg, `/repos/${encodeURIComponent(cfg.user)}/${encodeURIComponent(cfg.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (!r.ok) throw new Error(await errText(r));
  const j = await r.json();
  return {
    paths: (j.tree || []).filter((t) => t.type === "blob" && /\.partes\/manifest\.json$/.test(t.path)).map((t) => t.path),
    truncated: !!j.truncated,
  };
}

// Baja todas las partes, las une y comprueba el tamaño. Devuelve { blob, manifest }.
async function downloadSplit(cfg, manifestPath, onStatus) {
  const branch = cfg.branch || "main";
  const dir = manifestPath.replace(/\/manifest\.json$/, "");
  const raw = { headers: { Accept: "application/vnd.github.raw+json" } };
  const base = `/repos/${encodeURIComponent(cfg.user)}/${encodeURIComponent(cfg.repo)}/contents/`;
  const get = async (path) => {
    const r = await gh(cfg, `${base}${repoPath("", path)}?ref=${encodeURIComponent(branch)}`, raw);
    if (!r.ok) throw new Error(path + " → " + (await errText(r)));
    return r;
  };
  const manifest = await (await get(manifestPath)).json();
  const blobs = [];
  for (let i = 0; i < manifest.partFiles.length; i++) {
    onStatus(`Descargando parte ${i + 1} de ${manifest.partFiles.length}…`);
    blobs.push(await (await get(`${dir}/${manifest.partFiles[i]}`)).blob());
  }
  const blob = new Blob(blobs, { type: manifest.type || "application/octet-stream" });
  if (blob.size !== manifest.size) {
    throw new Error(`El tamaño no coincide (${blob.size} de ${manifest.size} bytes). Vuelve a intentarlo.`);
  }
  return { blob, manifest };
}

/* ---------- interfaz ---------- */

if (typeof document !== "undefined") {
  const $ = (s) => document.querySelector(s);
  const ids = ["user", "repo", "branch", "folder", "token"];
  let items = []; // { file, name, st, thumb, state, progress, status, cls, link, fillEl }
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
      const split = needsSplit(it.file) ? ` · en ${partsCount(it.file.size)} partes` : "";
      mt.textContent = `${fmtSize(it.file.size)} · ${repoDir(base, it.file)}${split}`;
      const bar = document.createElement("div"); bar.className = "bar";
      const fill = document.createElement("i"); fill.style.width = (it.progress || 0) * 100 + "%";
      bar.appendChild(fill);
      const st = document.createElement("div"); st.className = "status " + (it.cls || "");
      if (it.link) {
        const a = document.createElement("a");
        a.href = it.link; a.target = "_blank"; a.rel = "noopener";
        a.textContent = it.status || "Subido";
        st.appendChild(a);
      } else if (tooBig(it.file)) {
        st.textContent = "Supera el límite de " + fmtSize(MAX_FILE);
        st.className = "status err";
      } else {
        st.textContent = it.status || "";
      }
      info.append(nm, mt, bar, st);
      li.append(th, info);
      ul.appendChild(li);
      it.fillEl = fill;
      it.statusEl = st;
    });
    $("#actions").classList.toggle("hidden", items.length === 0);
    $("#uploadBtn").disabled = busy || !items.some((i) => i.state !== "ok" && !tooBig(i.file));
    $("#clearBtn").disabled = busy;
  }

  function setProgress(it, p) {
    it.progress = p;
    if (it.fillEl) it.fillEl.style.width = p * 100 + "%";
  }
  function setStatus(it, text) {
    it.status = text;
    if (it.statusEl) it.statusEl.textContent = text;
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
      it.name = it.name || uniqueName(it.file.name, n - 1); // el mismo nombre al reintentar
      it.st = it.st || { nextPart: 0 };
      it.state = "up"; it.status = "Subiendo…"; it.cls = ""; setProgress(it, 0.02);
      render();
      try {
        it.link = await uploadFile(cfg, it.file, it.name, repoDir(cfg.folder, it.file), it.st,
          (p) => setProgress(it, p), (t) => setStatus(it, t));
        it.state = "ok"; it.status = "Subido ✓"; it.cls = "ok"; setProgress(it, 1);
      } catch (e) {
        const extra = needsSplit(it.file) && it.st.nextPart > 0 ? ` (se reanuda en la parte ${it.st.nextPart + 1} al pulsar Subir)` : "";
        it.state = "err"; it.status = "Falló: " + (e && e.message ? e.message : e) + extra; it.cls = "err";
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

  /* --- archivos divididos: buscar y descargar --- */
  function splitMsg(text, kind) { const m = $("#splitMsg"); m.textContent = text; m.className = kind || ""; }

  async function findSplits() {
    const cfg = readForm();
    if (needsConfig(cfg)) { splitMsg("Completa la configuración primero.", "err"); return; }
    splitMsg("Buscando…");
    const ul = $("#splitList"); ul.textContent = "";
    try {
      const { paths, truncated } = await listSplits(cfg);
      if (!paths.length) { splitMsg("No hay archivos divididos en el repositorio."); return; }
      splitMsg(truncated ? "Lista incompleta: el repositorio es muy grande." : `${paths.length} archivo(s) dividido(s).`);
      paths.forEach((p) => {
        const li = document.createElement("li");
        li.className = "split";
        const label = document.createElement("div");
        label.className = "name";
        label.textContent = p.replace(/\/manifest\.json$/, "").replace(/\.partes$/, "");
        const btn = document.createElement("button");
        btn.type = "button"; btn.className = "secondary"; btn.textContent = "Descargar";
        btn.addEventListener("click", () => downloadOne(p, btn));
        li.append(label, btn);
        ul.appendChild(li);
      });
    } catch (e) {
      splitMsg("Error: " + (e && e.message ? e.message : e), "err");
    }
  }

  async function downloadOne(path, btn) {
    const cfg = readForm();
    btn.disabled = true;
    try {
      const { blob, manifest } = await downloadSplit(cfg, path, (t) => splitMsg(t));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = manifest.originalName || "archivo";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      splitMsg(`Listo: ${manifest.originalName} (${fmtSize(manifest.size)}) ✓`, "ok");
    } catch (e) {
      splitMsg("Error: " + (e && e.message ? e.message : e), "err");
    } finally {
      btn.disabled = false;
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
  $("#findSplitBtn").addEventListener("click", findSplits);

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
  module.exports = {
    stamp, safeName, uniqueName, categoryOf, monthFolder, repoDir, repoPath, tooBig, needsSplit,
    partsCount, partName, fmtSize, textToBase64, buildManifest, buildReadme,
    uploadFile, listSplits, downloadSplit, withRetry,
    SPLIT_AT, PART_SIZE, MAX_FILE,
  };
}

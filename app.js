// ===== Configuración =====
const MAX_ABS_DISTANCE = 2;
const MAX_REL_DISTANCE = 0.10;

// ===== Utilidades =====
const normalize = (s) =>
  (s || "")
    .toUpperCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const nifLetter = (num) => "TRWAGMYFPDXBNJZSQVHLCKE"[num % 23];

function canonDoc(raw) {
  if (!raw) return null;
  let s = normalize(raw).replace(/\s+/g, "");
  if (/^[XYZ]\d{7}[A-Z]$/.test(s)) {
    const map = { X: "0", Y: "1", Z: "2" };
    const num = parseInt(map[s[0]] + s.slice(1, 8), 10);
    const letter = s.slice(-1);
    return nifLetter(num) === letter ? s : null;
  }
  if (/^\d{8}[A-Z]$/.test(s)) {
    const num = parseInt(s.slice(0, 8), 10);
    const letter = s.slice(-1);
    return nifLetter(num) === letter ? s : null;
  }
  return null;
}

function extractDocFromText(text) {
  const T = text?.toUpperCase?.() || "";
  const list = T.match(/\b(?:[XYZ]\d{7}[A-Z]|\d{8}[A-Z])\b/g) || [];
  for (const c of list) {
    const ok = canonDoc(c);
    if (ok) return ok;
  }
  return null;
}

function levenshtein(a, b) {
  a = a || ""; b = b || "";
  const n = a.length, m = b.length;
  if (n === 0) return m; if (m === 0) return n;
  const dp = new Array(m + 1);
  for (let j = 0; j <= m; j++) dp[j] = j;
  for (let i = 1; i <= n; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= m; j++) {
      const temp = dp[j];
      dp[j] = (a[i - 1] === b[j - 1]) ? prev : Math.min(prev + 1, dp[j] + 1, dp[j - 1] + 1);
      prev = temp;
    }
  }
  return dp[m];
}

function similarEnough(a, b) {
  const A = normalize(a), B = normalize(b);
  const dist = levenshtein(A, B);
  const maxLen = Math.max(A.length, B.length) || 1;
  const threshold = Math.max(MAX_ABS_DISTANCE, Math.round(maxLen * MAX_REL_DISTANCE));
  return { ok: dist <= threshold, dist, threshold };
}

// ===== MRZ (opcional para nombre) =====
function parseMRZ(text) {
  const lines = (text || "").split(/\r?\n/).map(l => l.trim());
  const mrzLines = lines.filter(l => /^[A-Z0-9<]{25,}$/.test(l));
  if (mrzLines.length < 2) return null;
  const L1 = mrzLines[mrzLines.length - 2];
  let nameRaw = null;
  const nameMatch = L1.match(/([A-Z<]{10,})/);
  if (nameMatch) nameRaw = nameMatch[1].replace(/<+/g, " ").trim();
  return { name: nameRaw };
}

// ===== Estado =====
let baseByDoc = new Map();

// Mapeo flexible de cabeceras
function getCell(obj, keys) {
  const all = Object.keys(obj);
  for (const k of all) {
    const nk = normalize(k).replace(/\s+/g, "");
    for (const want of keys) {
      const nw = normalize(want).replace(/\s+/g, "");
      if (nk === nw) return obj[k];
    }
  }
  return "";
}

// Construye nombres (full / short)
function makeNamesFromRow(r) {
  const full = normalize([r.nombre, r.apellido1, r.apellido2].filter(Boolean).join(" "));
  const short = normalize([r.nombre, r.apellido1].filter(Boolean).join(" "));
  return { full, short };
}

// Carga Excel con tolerancia de cabeceras
async function loadExcel(file) {
  return new Promise((resolve, reject) => {
    if (!window.XLSX) return reject(new Error("Librería XLSX no cargada."));
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

        baseByDoc.clear();
        let rawCount = 0, okCount = 0;

        for (const r of rows) {
          rawCount++;
          // Intenta leer cabeceras con nombres flexibles
          const documento = getCell(r, ["documento", "doc", "dni", "nif", "nie"]);
          const nombre    = getCell(r, ["nombre", "name"]);
          const apellido1 = getCell(r, ["apellido1", "apellido 1", "ap1", "primer apellido"]);
          const apellido2 = getCell(r, ["apellido2", "apellido 2", "ap2", "segundo apellido"]);

          const docCanon = canonDoc(documento);
          const tmp = { nombre, apellido1, apellido2 };
          const { full, short } = makeNamesFromRow(tmp);

          if (!docCanon) continue;
          if (!full && !short) continue;

          const item = { doc: docCanon, full, short, originalRow: { documento, nombre, apellido1, apellido2 } };
          const arr = baseByDoc.get(docCanon) || [];
          arr.push(item);
          baseByDoc.set(docCanon, arr);
          okCount++;
        }

        resolve({ rawCount, okCount });
      } catch (e) { reject(e); }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ===== DOM =====
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const startCamBtn = document.getElementById("startCamBtn");
const captureBtn = document.getElementById("captureBtn");
const imageInput = document.getElementById("imageInput");
const excelInput = document.getElementById("excelInput");
const baseStatus = document.getElementById("baseStatus");
const indicator = document.getElementById("indicator");
const matchInfo = document.getElementById("matchInfo");
const manualDoc = document.getElementById("manualDoc");
const manualName = document.getElementById("manualName");
const manualCheckBtn = document.getElementById("manualCheckBtn");
const focusDocToggle = document.getElementById("focusDocToggle");

function setResult(ok, info) {
  indicator.className = "indicator " + (ok ? "check" : "cross");
  indicator.textContent = ok ? "✅ Coincide" : "❌ No coincide";
  matchInfo.textContent = info || "";
}

function compareAgainstBase(docCanon, nameCanon) {
  const list = baseByDoc.get(docCanon);
  if (!list || list.length === 0) return setResult(false, `Documento ${docCanon} no está en la base.`);
  for (const r of list) {
    if (nameCanon === r.full || nameCanon === r.short) return setResult(true, "Documento y nombre coinciden (exacto).");
    const s1 = similarEnough(nameCanon, r.full);
    const s2 = similarEnough(nameCanon, r.short);
    if (s1.ok || s2.ok) return setResult(true, "Documento coincide y el nombre es similar (tolerancia aplicada).");
  }
  const candidates = list.map(r => [r.originalRow.nombre, r.originalRow.apellido1, r.originalRow.apellido2].filter(Boolean).join(" ")).join(" · ");
  return setResult(false, `Documento encontrado, pero el nombre no coincide. En base: ${candidates}`);
}

// ===== Cámara & OCR =====
async function grabVideoFrame() {
  const track = video.srcObject?.getVideoTracks?.()[0];
  if (!track) throw new Error("Cámara no iniciada.");
  if ("ImageCapture" in window) {
    const imageCap = new ImageCapture(track);
    return await imageCap.grabFrame();
  } else {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) throw new Error("Vídeo no listo.");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    return await createImageBitmap(canvas);
  }
}

function cropBitmapToROI(bitmap, roi) {
  const W = bitmap.width, H = bitmap.height;
  const sx = Math.max(0, Math.round(roi.x * W));
  const sy = Math.max(0, Math.round(roi.y * H));
  const sw = Math.min(W - sx, Math.round(roi.w * W));
  const sh = Math.min(H - sy, Math.round(roi.h * H));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Promise(res => c.toBlob(b => res({ blob: b, width: sw, height: sh }), 'image/jpeg', 0.95));
}

async function ocrImage(imageBitmap) {
  const w = Math.min(1280, imageBitmap.width);
  const scale = w / imageBitmap.width;
  const h = Math.round(imageBitmap.height * scale);
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imageBitmap, 0, 0, w, h);
  const fullBlob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.9));

  const useROI = !!focusDocToggle?.checked;
  const roi = { x: 0.15, y: 0.60, w: 0.70, h: 0.30 };
  const roiData = useROI ? await cropBitmapToROI(imageBitmap, roi) : null;

  if (!window.Tesseract) throw new Error("Librería Tesseract no cargada.");

  const worker = await Tesseract.createWorker();
  try {
    await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789< " });
    const { data: mrzData } = await worker.recognize(fullBlob, "eng");
    const mrz = parseMRZ(mrzData.text || "");

    const targetBlob = roiData?.blob || fullBlob;
    await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑÜ 0123456789<" });
    const { data } = await worker.recognize(targetBlob, "eng");
    const text = data.text || "";
    const docCanon = extractDocFromText(text);

    let nameLine = mrz?.name || "";
    if (!nameLine) {
      const { data: nameData } = await worker.recognize(fullBlob, "eng");
      const t2 = nameData.text || "";
      nameLine = t2.split(/\r?\n/).map(l=>l.trim()).filter(l=>l && /^[A-ZÁÉÍÓÚÑÜ\s]+$/.test(l)).sort((a,b)=>b.length-a.length)[0] || "";
    }
    const nameCanon = normalize(nameLine);

    await worker.terminate();
    return { docCanon, nameCanon };
  } catch (e) {
    await worker.terminate();
    throw e;
  }
}

// ===== Eventos =====
startCamBtn.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = stream;
    captureBtn.disabled = false;
  } catch (e) {
    alert("No se pudo acceder a la cámara. Prueba a usar el navegador del sistema (Chrome/Safari) y HTTPS.");
  }
});

captureBtn.addEventListener("click", async () => {
  setResult(false, "Procesando imagen...");
  try {
    const bitmap = await grabVideoFrame();
    const res = await ocrImage(bitmap);
    if (!res.docCanon) return setResult(false, "No se pudo extraer un DNI/NIE válido.");
    if (!res.nameCanon) return setResult(false, "No se reconoció el nombre.");
    compareAgainstBase(res.docCanon, res.nameCanon);
  } catch (e) {
    console.error(e);
    setResult(false, "Error de OCR. Reintenta con mejor iluminación/encuadre.");
  }
});

imageInput.addEventListener("change", async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  setResult(false, "Procesando imagen...");
  try {
    const bitmap = await createImageBitmap(f);
    const res = await ocrImage(bitmap);
    if (!res.docCanon) return setResult(false, "No se pudo extraer un DNI/NIE válido de la imagen.");
    if (!res.nameCanon) return setResult(false, "No se reconoció el nombre en la imagen.");
    compareAgainstBase(res.docCanon, res.nameCanon);
  } catch (err) {
    console.error(err);
    setResult(false, "Error de OCR con la imagen subida.");
  }
});

excelInput.addEventListener("change", async (e) => {
  baseStatus.textContent = "Cargando base...";
  const f = e.target.files?.[0];
  if (!f) { baseStatus.textContent = "Base no cargada."; return; }
  try {
    const { rawCount, okCount } = await loadExcel(f);
    if (!okCount) {
      baseStatus.textContent = "No se cargaron registros válidos. Revisa cabeceras o formato.";
    } else {
      baseStatus.textContent = `Base cargada. Registros válidos: ${okCount} (leídos: ${rawCount}).`;
    }
  } catch (err) {
    console.error(err);
    if (!window.XLSX) {
      baseStatus.textContent = "Error: librería XLSX no cargada. Revisa conexión o CDN.";
    } else {
      baseStatus.textContent = "Error al cargar el Excel. Revisa cabeceras: documento/nombre/apellido1/apellido2.";
    }
  }
});

manualCheckBtn.addEventListener("click", () => {
  const docCanon = canonDoc(manualDoc.value);
  const nameCanon = normalize(manualName.value);
  if (!docCanon) return setResult(false, "Documento no válido.");
  if (!nameCanon) return setResult(false, "Introduce un nombre válido.");
  compareAgainstBase(docCanon, nameCanon);
});

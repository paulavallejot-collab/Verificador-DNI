// ===== Configuración =====
const MAX_ABS_DISTANCE = 2;       // distancia Levenshtein mínima
const MAX_REL_DISTANCE = 0.10;    // 10% de la longitud del nombre

// ===== Utilidades de texto =====
const normalize = (s) =>
  (s || "")
    .toUpperCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// DNI/NIF: 8 dígitos + letra. NIE: X/Y/Z + 7 dígitos + letra.
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
  const T = text.toUpperCase();
  const candidates = T.match(/(?:[XYZ]\d{7}[A-Z]|\d{8}[A-Z])/g) || [];
  for (const c of candidates) {
    const canon = canonDoc(c);
    if (canon) return canon;
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
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= m; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) dp[j] = prev;
      else dp[j] = Math.min(prev + 1, dp[j] + 1, dp[j - 1] + 1);
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

function parseMRZ(text) {
  const lines = text.split(/?
/).map(l => l.trim());
  const mrzLines = lines.filter(l => /^[A-Z0-9<]{25,}$/.test(l));
  if (mrzLines.length < 2) return null;
  const L1 = mrzLines[mrzLines.length - 2];
  let nameRaw = null;
  const nameMatch = L1.match(/([A-Z<]{10,})/);
  if (nameMatch) {
    nameRaw = nameMatch[1].replace(/<+/g, " ").trim();
  }
  return { name: nameRaw };
}

let baseByDoc = new Map();

function makeNamesFromRow(r) {
  const normalizeName = (o) => normalize([o.nombre, o.apellido1, o.apellido2].filter(Boolean).join(" "));
  return { full: normalizeName(r), short: normalize([r.nombre, r.apellido1].filter(Boolean).join(" ")) };
}

function loadExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        baseByDoc.clear();
        for (const r of rows) {
          const doc = canonDoc(r.documento);
          if (!doc) continue;
          const { full, short } = makeNamesFromRow(r);
          const item = { doc, full, short, originalRow: r };
          const arr = baseByDoc.get(doc) || [];
          arr.push(item);
          baseByDoc.set(doc, arr);
        }
        resolve({ count: rows.length });
      } catch (e) { reject(e); }
    };
    reader.readAsArrayBuffer(file);
  });
}

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
  const candidates = list.map(r => r.originalRow.nombre+" "+r.originalRow.apellido1+" "+(r.originalRow.apellido2||"")).join(" · ");
  return setResult(false, `Documento encontrado, pero el nombre no coincide. En base: ${candidates}`);
}

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

  const worker = await Tesseract.createWorker();
  try {
    await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789< " });
    const { data: mrzData } = await worker.recognize(fullBlob, "eng");
    const mrz = (mrzData.text||"");
    let nameLine = (parseMRZ(mrz)||{}).name || "";

    const targetBlob = roiData?.blob || fullBlob;
    await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑÜ 0123456789<" });
    const { data } = await worker.recognize(targetBlob, "eng");
    const text = data.text || "";
    const docCanon = extractDocFromText(text);

    if (!nameLine) {
      const { data: nameData } = await worker.recognize(fullBlob, "eng");
      const t2 = nameData.text || "";
      nameLine = t2.split(/?
/).map(l=>l.trim()).filter(l=>l && /^[A-ZÁÉÍÓÚÑÜ\s]+$/.test(l)).sort((a,b)=>b.length-a.length)[0] || "";
    }
    const nameCanon = normalize(nameLine);

    await worker.terminate();
    return { docCanon, nameCanon };
  } catch (e) {
    await worker.terminate();
    throw e;
  }
}

startCamBtn.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = stream; captureBtn.disabled = false;
  } catch (e) { alert("No se pudo acceder a la cámara. Puedes subir una imagen."); }
});

captureBtn.addEventListener("click", async () => {
  setResult(false, "Procesando imagen...");
  try {
    const bitmap = await grabVideoFrame();
    const res = await ocrImage(bitmap);
    if (!res.docCanon) return setResult(false, "No se pudo extraer un DNI/NIE válido.");
    if (!res.nameCanon) return setResult(false, "No se reconoció el nombre.");
    compareAgainstBase(res.docCanon, res.nameCanon);
  } catch (e) { setResult(false, "Error de OCR. Reintenta con mejor iluminación/encuadre."); }
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
  } catch { setResult(false, "Error de OCR con la imagen subida."); }
});

excelInput.addEventListener("change", async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  baseStatus.textContent = "Cargando base...";
  try {
    const { count } = await loadExcel(f);
    baseStatus.textContent = `Base cargada. Registros: ${count}`;
  } catch { baseStatus.textContent = "Error al cargar el Excel (cabeceras: documento, nombre, apellido1, apellido2)."; }
});

manualCheckBtn.addEventListener("click", () => {
  const docCanon = canonDoc(manualDoc.value);
  const nameCanon = normalize(manualName.value);
  if (!docCanon) return setResult(false, "Documento no válido.");
  if (!nameCanon) return setResult(false, "Introduce un nombre válido.");
  compareAgainstBase(docCanon, nameCanon);
});

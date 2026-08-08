/**
 * ocr-engine.js — v8.2
 * Motor OCR con captura de cámara, máscara INE, compresión inteligente y parser anclado a etiquetas.
 * Compatible con Tesseract.js v4.x (CDN 4.1.1).
 *
 * v8.1: Pasos OCR separados (createWorker → loadLanguage → initialize).
 * v8.2: preprocessForOCR con normalización adaptativa de brillo (mejora fotos oscuras/bajo contraste).
 *       parseIneFields: filtro de ruido por palabra en nombre; exclusión de fechas en sección.
 */

// ════════════════════════════════════════════════════════════════
// 0. LÍMITES Y ESTADO GLOBAL
// ════════════════════════════════════════════════════════════════

window.IMG_LIMITS = {
    ine:     { maxW: 800,  maxH: 520,  quality: 0.65, maxKB: 150 },
    profile: { maxW: 400,  maxH: 400,  quality: 0.60, maxKB:  80 }
};

// Almacena la imagen INE ya comprimida lista para guardar en BD
window.CRM = window.CRM || {};
window.CRM._ineBase64 = null;

let _cameraStream = null;  // Stream de cámara activo

// ════════════════════════════════════════════════════════════════
// 1. UTILIDADES DE IMAGEN
// ════════════════════════════════════════════════════════════════

window.fileToBase64 = function(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload  = () => resolve(reader.result);
        reader.onerror = e  => reject(e);
    });
};

/**
 * Comprime y redimensiona una imagen respetando los límites indicados.
 * @param {string|File} source  – base64, blob URL o File
 * @param {object}      limits  – { maxW, maxH, quality, maxKB }
 * @returns {Promise<{b64:string, kb:number, w:number, h:number}>}
 */
window.compressToLimits = function(source, limits) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let w = img.naturalWidth;
            let h = img.naturalHeight;

            // Reducir si supera límite; nunca ampliar
            const ratio = Math.min(limits.maxW / w, limits.maxH / h, 1);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);

            const b64 = canvas.toDataURL('image/jpeg', limits.quality);
            // Estimación de KB: cada char base64 ≈ 0.75 bytes
            const kb  = Math.round((b64.length * 3) / 4 / 1024);
            resolve({ b64, kb, w, h });
        };
        img.onerror = reject;
        img.src = (typeof source === 'string') ? source : URL.createObjectURL(source);
    });
};

// ════════════════════════════════════════════════════════════════
// 2. MODAL DE CAPTURA INE
// ════════════════════════════════════════════════════════════════

window.openIneCapture = function() {
    window.CRM._ineBase64 = null;
    document.getElementById('icPreviewSection').style.display = 'none';
    document.getElementById('icSizeBadge').style.display      = 'none';
    document.getElementById('icCameraError').style.display    = 'none';
    window.openModal('modalIneCapture');
    _switchCaptureTab('camera');
};

window.closeIneCapture = function() {
    _stopCamera();
    window.closeModal('modalIneCapture');
};

// Exponer para botones HTML
window.icSwitchTab = function(tab) { _switchCaptureTab(tab); };

function _switchCaptureTab(tab) {
    const camDiv  = document.getElementById('icTab_camera');
    const fileDiv = document.getElementById('icTab_file');
    const btnCam  = document.getElementById('icBtnTabCam');
    const btnFile = document.getElementById('icBtnTabFile');
    if (!camDiv) return;

    if (tab === 'camera') {
        camDiv.style.display  = 'block';
        fileDiv.style.display = 'none';
        btnCam.className  = 'primary-btn small-btn';
        btnFile.className = 'secondary-btn small-btn';
        _startCamera();
    } else {
        camDiv.style.display  = 'none';
        fileDiv.style.display = 'block';
        btnFile.className = 'primary-btn small-btn';
        btnCam.className  = 'secondary-btn small-btn';
        _stopCamera();
    }
}

// ── CÁMARA ────────────────────────────────────────────────────────────────

async function _startCamera() {
    const video = document.getElementById('icVideo');
    if (!video) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        _showCameraError('Cámara no compatible con este navegador.');
        return;
    }

    try {
        _cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        video.srcObject = _cameraStream;
        await video.play();
    } catch (e) {
        try {
            // Fallback: cualquier cámara disponible
            _cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
            video.srcObject = _cameraStream;
            await video.play();
        } catch (e2) {
            _showCameraError('No se pudo acceder a la cámara. Usa "📁 Archivo".');
            _switchCaptureTab('file');
        }
    }
}

function _stopCamera() {
    if (_cameraStream) {
        _cameraStream.getTracks().forEach(t => t.stop());
        _cameraStream = null;
    }
    const video = document.getElementById('icVideo');
    if (video) { video.srcObject = null; video.load(); }
}

function _showCameraError(msg) {
    const el = document.getElementById('icCameraError');
    if (el) { el.textContent = '⚠️ ' + msg; el.style.display = 'block'; }
}

window.icCapturarFoto = function() {
    const video = document.getElementById('icVideo');
    if (!video || !video.srcObject) { alert('Cámara no disponible. Usa "Archivo".'); return; }

    const vw = video.videoWidth  || 1280;
    const vh = video.videoHeight || 720;

    // Crop directo en píxeles del video — independiente de CSS y object-fit.
    // La credencial INE tiene proporción 856:540 (≈ 1.585:1).
    // Tomamos el 90% del ancho del frame, centrado y con ese aspect-ratio.
    const INE_RATIO = 856 / 540;
    let cropW = Math.round(vw * 0.90);
    let cropH = Math.round(cropW / INE_RATIO);

    // Si el alto calculado excede el frame, ajustar por alto
    if (cropH > vh * 0.92) {
        cropH = Math.round(vh * 0.92);
        cropW = Math.round(cropH * INE_RATIO);
    }

    const sx = Math.round((vw - cropW) / 2);
    const sy = Math.round((vh - cropH) / 2);

    const canvas = document.createElement('canvas');
    canvas.width  = cropW;
    canvas.height = cropH;
    canvas.getContext('2d').drawImage(video, sx, sy, cropW, cropH, 0, 0, cropW, cropH);

    const raw = canvas.toDataURL('image/jpeg', 0.95);
    _stopCamera();
    _showCapturePreview(raw);
};

// ── ARCHIVO ───────────────────────────────────────────────────────────────

window.icHandleFile = async function(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];

    let raw;
    if (file.type === 'application/pdf') {
        raw = await _pdfToBase64(file);
    } else {
        raw = await window.fileToBase64(file);
    }
    _showCapturePreview(raw);
};

async function _pdfToBase64(file) {
    const lib = window['pdfjs-dist/build/pdf'];
    if (!lib) throw new Error('Librería PDF.js no disponible.');
    lib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const buf  = await file.arrayBuffer();
    const pdf  = await lib.getDocument(buf).promise;
    const page = await pdf.getPage(1);
    const vp   = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return canvas.toDataURL('image/jpeg', 0.85);
}

// ── VISTA PREVIA + COMPRESIÓN ─────────────────────────────────────────────

async function _showCapturePreview(rawBase64) {
    try {
        const { b64, kb, w, h } = await window.compressToLimits(rawBase64, window.IMG_LIMITS.ine);
        window.CRM._ineBase64 = b64;

        const section = document.getElementById('icPreviewSection');
        const img     = document.getElementById('icPreviewImg');
        const badge   = document.getElementById('icSizeBadge');

        if (img)     { img.src = b64; }
        if (section) { section.style.display = 'block'; }

        // Ocultar paneles de captura
        const camDiv  = document.getElementById('icTab_camera');
        const fileDiv = document.getElementById('icTab_file');
        if (camDiv)  camDiv.style.display  = 'none';
        if (fileDiv) fileDiv.style.display = 'none';

        // Badge de tamaño
        if (badge) {
            const ok    = kb <= window.IMG_LIMITS.ine.maxKB;
            const color = ok ? '#2e7d32' : '#c62828';
            badge.innerHTML = `<span style="color:${color};font-weight:bold;">📦 ${kb} KB</span> · ${w}×${h}px · ${ok ? '✅ Óptimo' : '⚠️ Comprimiendo más...'}`;
            badge.style.display = 'block';
        }
    } catch (e) {
        alert('No se pudo procesar la imagen: ' + e.message);
    }
}

window.icRetomar = function() {
    window.CRM._ineBase64 = null;
    document.getElementById('icPreviewSection').style.display = 'none';
    document.getElementById('icSizeBadge').style.display      = 'none';
    _switchCaptureTab('camera');
};

window.icUsarEstaImagen = async function() {
    if (!window.CRM._ineBase64) { alert('Captura una imagen primero.'); return; }

    // Mostrar miniatura y estado en el formulario
    const preview = document.getElementById('cedula_ine_preview');
    const status  = document.getElementById('ine-capture-status');

    if (preview) {
        preview.src = window.CRM._ineBase64;
        preview.style.display = 'block';
    }
    if (status) status.textContent = '🔍 Imagen cargada. Leyendo INE...';

    window.closeIneCapture();

    // Lanzar OCR automáticamente
    await window.runOcrOnCurrentIne();
};

// ════════════════════════════════════════════════════════════════
// 3. PRE-PROCESAMIENTO (alto contraste para Tesseract)
// ════════════════════════════════════════════════════════════════

window.preprocessForOCR = function(imageSource) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            const scale  = 3.0;
            const canvas = document.createElement('canvas');
            canvas.width  = img.width  * scale;
            canvas.height = img.height * scale;
            const ctx     = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data    = imgData.data;
            const n       = data.length;

            // ── Paso 1: Calcular luminosidad de cada píxel ───────────────
            const lums = new Uint8Array(n / 4);
            for (let i = 0, p = 0; i < n; i += 4, p++) {
                lums[p] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
            }

            // ── Paso 2: Normalización adaptativa (percentil 5 → 95) ──────
            // Recortar extremos resiste brillos puntuales o fotos oscuras.
            // Garantiza que tanto imágenes escaneadas como fotos con poca luz
            // queden con rango completo de contraste antes del umbral.
            const sorted = new Uint8Array(lums).sort();
            const lo     = sorted[Math.floor(sorted.length * 0.05)] || 0;
            const hi     = sorted[Math.floor(sorted.length * 0.95)] || 255;
            const range  = Math.max(hi - lo, 1);

            // ── Paso 3: Stretch de histograma → umbral en 128 ───────────
            for (let i = 0, p = 0; i < n; i += 4, p++) {
                const norm = Math.min(255, Math.max(0, Math.round((lums[p] - lo) / range * 255)));
                const val  = norm < 128 ? 0 : 255;
                data[i] = data[i + 1] = data[i + 2] = val;
                // canal alpha sin cambios
            }

            ctx.putImageData(imgData, 0, 0);
            resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        img.onerror = () => resolve(imageSource);
        img.src = imageSource;
    });
};

// ════════════════════════════════════════════════════════════════
// 4. OCR
// ════════════════════════════════════════════════════════════════

window.runOcrOnCurrentIne = async function() {
    const status = document.getElementById('ine-capture-status');
    const setStatus = (msg) => { if (status) status.textContent = msg; };

    if (!window.CRM._ineBase64) {
        setStatus('⚠️ No hay imagen INE cargada.');
        return;
    }
    if (typeof Tesseract === 'undefined') {
        setStatus('⚠️ Motor OCR no disponible. Captura los datos manualmente.');
        return;
    }

    setStatus('⏳ Iniciando motor OCR...');
    document.body.style.cursor = 'wait';

    // v8.1: worker declarado fuera del try para poder terminarlo en finally
    let worker = null;

    try {
        const processed = await window.preprocessForOCR(window.CRM._ineBase64);

        // ── PASO 1: Crear worker (sin idioma) ────────────────────────────
        // Bug Tesseract.js v4: createWorker('spa') llama loadLanguage+initialize
        // internamente con .catch(()=>{}) que silencia fallos → api queda null.
        // Solución: pasar null como langs → worker se crea sin cargar idioma.
        // Luego llamamos loadLanguage e initialize por separado para tener
        // manejo real de errores en cada paso.
        setStatus('⏳ Iniciando worker OCR...');
        const BASE = window.location.origin;
        worker = await Tesseract.createWorker(null, 1, {
            workerPath: `${BASE}/js/tesseract-worker.min.js`,
            corePath:   `${BASE}/js/tesseract-core.wasm.js`,  // sufijo .js → omite detección SIMD
            langPath:   `${BASE}/tessdata`,                    // tessdata local = mismo-origen, más fiable
            logger: m => {
                if (m.status) {
                    const pct = m.progress != null ? ` ${Math.round(m.progress * 100)}%` : '';
                    setStatus(`⏳ ${m.status}${pct}`);
                }
            },
        });

        // ── PASO 2: Descargar tessdata (paso explícito → rechaza si falla) ─
        setStatus('⏳ Descargando datos OCR del servidor...');
        await worker.loadLanguage('spa');

        // ── PASO 3: Inicializar TessBaseAPI (paso explícito → rechaza si falla) ─
        setStatus('⏳ Inicializando motor de texto...');
        await worker.initialize('spa');

        // ── PASO 4: Parámetros ───────────────────────────────────────────
        setStatus('⏳ Configurando OCR...');
        await worker.setParameters({
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ0123456789.,/-: ',
            tessedit_pageseg_mode:   '6',
        });

        // ── PASO 5: Reconocer texto ───────────────────────────────────────
        setStatus('⏳ Reconociendo texto en la imagen...');
        const { data: { text } } = await worker.recognize(processed);

        console.log('OCR RAW:', text);
        const fields = window.parseIneFields(text);
        window.fillCedulaForm(fields);
        setStatus('✅ Datos leídos. Por favor verifica que sean correctos.');

    } catch (e) {
        // e puede ser: Error, string (Tesseract rechaza con string), ProgressEvent
        const detalle = e instanceof Error
            ? e.message
            : (typeof e === 'string'
                ? e
                : (e && e.type ? `Error de red: ${e.type}` : JSON.stringify(e) || 'Error desconocido'));
        console.error('OCR Error completo:', e);
        setStatus(`⚠️ OCR falló: ${detalle}. Captura manualmente o intenta de nuevo.`);
    } finally {
        document.body.style.cursor = 'default';
        // Terminar el worker siempre (incluso si falló a medias)
        if (worker) {
            try { await worker.terminate(); } catch (_) {}
            worker = null;
        }
    }
};

// ════════════════════════════════════════════════════════════════
// 5. PARSER MEJORADO — anclado a etiquetas INE
// ════════════════════════════════════════════════════════════════
//
// PROBLEMA ANTERIOR: el parser buscaba cualquier grupo de 4 dígitos,
// confundiendo SECCIÓN (ej: 0234) con VIGENCIA (ej: 2029) porque
// aparecen en la misma línea inferior del INE.
//
// SOLUCIÓN: cada campo se busca DESPUÉS de su etiqueta de texto.
// ════════════════════════════════════════════════════════════════

window.parseIneFields = function(text) {
    const raw   = text.toUpperCase();
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 1);
    const full  = lines.join(' ');
    const f     = {};   // campos extraídos

    // ── NOMBRE ────────────────────────────────────────────────────────────
    const iNombre    = lines.findIndex(l => l.includes('NOMBRE'));
    const iDomicilio = lines.findIndex(l => l.includes('DOMICILIO'));

    if (iNombre !== -1 && iDomicilio > iNombre) {
        const SKIP = /^(APELLIDO|PATERNO|MATERNO|NOMBRES?|SEXO|H|M)$/;
        const partes = lines
            .slice(iNombre + 1, iDomicilio)
            .map(l => l.replace(/[^A-ZÁÉÍÓÚÑ\s]/g, '').trim())
            // Filtrar palabras cortas DENTRO de cada línea (ruido OCR del fondo del INE)
            .map(l => l.split(/\s+/).filter(w => w.length > 2).join(' ').trim())
            .filter(l => l.length > 2 && !SKIP.test(l));
        f.nombre = partes.join(' ').replace(/\s+/g, ' ').trim();
    }
    if (!f.nombre) {
        const m = full.match(/NOMBRE\s+([A-ZÁÉÍÓÚÑ\s]+?)(?=DOMICILIO)/);
        if (m) {
            // Limpiar también el fallback regex: quitar palabras de 1-2 letras
            f.nombre = m[1].trim().split(/\s+/).filter(w => w.length > 2).join(' ');
        }
    }

    // ── DOMICILIO ─────────────────────────────────────────────────────────
    if (iDomicilio !== -1) {
        const STOP = /CLAVE|ELECTOR|FOLIO|CURP|ESTADO|MUNICIPIO|A[ÑN]O|REGISTRO|VIGENCIA|SECCI/;
        const bloque = [];
        for (let i = iDomicilio + 1; i < lines.length; i++) {
            if (STOP.test(lines[i])) break;
            if (lines[i].length > 3) bloque.push(lines[i]);
        }
        f.domicilio = bloque.join(' ').replace(/^[^A-Z0-9]+/, '').trim();
    }

    // ── CURP ──────────────────────────────────────────────────────────────
    const mCurp = full.replace(/\s/g, '').match(/[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d/);
    if (mCurp) {
        f.curp = mCurp[0];
        const anio  = f.curp.substring(4, 6);
        const mes   = f.curp.substring(6, 8);
        const dia   = f.curp.substring(8, 10);
        const siglo = parseInt(anio) > 30 ? '19' : '20';
        f.fechaNacimiento = `${dia}/${mes}/${siglo}${anio}`;
        const sx = f.curp.charAt(10);
        f.sexo = (sx === 'H' || sx === 'M') ? sx : '';
    }

    // ── CLAVE DE ELECTOR ──────────────────────────────────────────────────
    const mClave = full.replace(/\s/g, '').match(/[A-Z]{6}\d{8}[A-Z0-9]{4}/);
    if (mClave) f.claveElector = mClave[0];

    // ── SECCIÓN ELECTORAL ─────────────────────────────────────────────────
    // ⚠️ CRÍTICO: buscar DESPUÉS de la etiqueta "SECCIÓN" para no confundir
    // con VIGENCIA (ambos son 4 dígitos en la misma línea inferior del INE).
    //
    // Estrategia: anclar al texto "SECCIÓN" + capturar los siguientes 4 dígitos.
    // El [\s\S]{0,30} permite texto basura entre etiqueta y valor (OCR imperfecto).
    const mSeccion = full.match(/SECCI[OÓ]N[\s\S]{0,30}?(\d{4})/);
    if (mSeccion) {
        f.seccion = mSeccion[1];
    } else {
        // Fallback: 4 dígitos que NO sean año NI estén en contexto de fecha (dd/mm/yyyy)
        const todos4dig = [...full.matchAll(/\b(\d{4})\b/g)].map(m => ({ n: m[1], idx: m.index }));
        const candidatos = todos4dig.filter(({ n, idx }) => {
            const v = parseInt(n);
            if (v >= 1900 && v <= 2099) return false;   // es un año
            // Excluir si hay un separador de fecha ( / o - ) inmediatamente antes o después
            const ctx = full.substring(Math.max(0, idx - 3), idx + n.length + 3);
            if (/\d[\/\-]\d/.test(ctx)) return false;   // contexto de fecha dd/mm o mm/yyyy
            return true;
        });
        if (candidatos.length) f.seccion = candidatos[0].n;
    }

    return f;
};

// ════════════════════════════════════════════════════════════════
// 6. LLENAR FORMULARIO
// ════════════════════════════════════════════════════════════════

window.fillCedulaForm = function(fields) {
    const set = (id, val) => {
        if (!val) return;
        const el = document.getElementById(id);
        if (el) el.value = val;
    };
    set('cedula_nombre',           fields.nombre);
    set('cedula_domicilio',        fields.domicilio);
    set('cedula_curp',             fields.curp);
    set('cedula_clave_elector',    fields.claveElector);
    set('cedula_fecha_nacimiento', fields.fechaNacimiento);
    set('cedula_seccion',          fields.seccion);
    if (fields.sexo) {
        const sel = document.getElementById('cedula_sexo');
        if (sel) sel.value = fields.sexo;
    }
};

// ════════════════════════════════════════════════════════════════
// 7. FOTO DE PERFIL — compresión estándar con badge de tamaño
// ════════════════════════════════════════════════════════════════

/**
 * Llamado desde onchange del input de foto de perfil.
 * Comprime y muestra el tamaño resultante.
 * Guarda la versión comprimida en input._compressedBase64.
 */
window.handleProfilePhotoSelect = async function(input, previewId, badgeId) {
    if (!input.files || !input.files[0]) return;

    try {
        const raw  = await window.fileToBase64(input.files[0]);
        const { b64, kb, w, h } = await window.compressToLimits(raw, window.IMG_LIMITS.profile);

        // Guardar comprimida en el input para que submitCedula la use
        input._compressedBase64 = b64;

        // Mostrar miniatura
        const preview = document.getElementById(previewId);
        if (preview) {
            preview.src = b64;
            preview.style.display = 'block';
        }

        // Badge de tamaño
        const badge = document.getElementById(badgeId);
        if (badge) {
            const ok    = kb <= window.IMG_LIMITS.profile.maxKB;
            const color = ok ? '#2e7d32' : '#e65100';
            badge.innerHTML = `<span style="color:${color};font-weight:bold;">📦 ${kb} KB</span> · ${w}×${h}px`;
            badge.style.display = 'block';
        }
    } catch (e) {
        console.error('Error procesando foto perfil:', e);
    }
};

// ════════════════════════════════════════════════════════════════
// 8. LEGADO — compatibilidad con el flujo antiguo de file input
// ════════════════════════════════════════════════════════════════

window.preprocessImage = window.preprocessForOCR;

window.handleIneUpload = async function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const raw = await window.fileToBase64(file);
    await _showCapturePreview(raw);
    await window.runOcrOnCurrentIne();
};

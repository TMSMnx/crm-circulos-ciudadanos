/**
 * circles-manager.js
 * Módulo Central: Gestión de Círculos, Integrantes, PDF, Validaciones y Modo Offline.
 * Versión: 11.11 (Compresión, Offline-First, Escotilla GPS y Contador Visual)
 */

window.CRM = window.CRM || {};

// ======================================================
// 1. CONFIGURACIÓN Y DATOS
// ======================================================

const CAUSAS_LIST = [
    "Medio Ambiente y Sustentabilidad", "Derechos Humanos e Inclusión", "Movilidad y Transporte Digno",
    "Educación y Cultura", "Salud y Bienestar", "Seguridad y Justicia", "Innovación y Emprendimiento",
    "Protección Animal", "Igualdad de Género y Mujeres", "Rescate de Espacios Públicos",
    "Participación Ciudadana", "Deporte y Juventud", "Causa Migrante y Binacional",       
    "Trabajadores y Productores", "Pueblos Originarios", "Diversidad Sexual y de Género"       
];

const ACTIVIDADES_LIST = [
    "Torneos Deportivos", "Talleres Artísticos", "Cine Debate", "Reforestación", "Limpieza de Espacios",
    "Clases de Idiomas", "Asesoría Legal Gratuita", "Jornadas de Salud", "Mercadito Local", "Círculos de Lectura"
];

const ESTADOS_MX_CIRCLES = [
    "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua",
    "Ciudad de México", "Coahuila", "Colima", "Durango", "Estado de México", "Guanajuato",
    "Guerrero", "Hidalgo", "Jalisco", "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca",
    "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco",
    "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas"
];

window.currentCircleData = {
    tipo: "", actividades: [], causas: [], acta: {}, cedulas: []
};

// ======================================================
// 🔥 NUEVO: COMPRESOR DE IMÁGENES AL VUELO (BALA DE PLATA) 🔥
// ======================================================
window.compressImageFile = function(file, maxWidth = 1000, maxHeight = 1000, quality = 0.6) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                // Mantener proporción
                if (width > height) {
                    if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
                } else {
                    if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Forzar salida a JPEG comprimido
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
};

// ======================================================
// 2. ESCUDO DE DATOS: VALIDACIONES EN TIEMPO REAL Y DUPLICADOS
// ======================================================

window.setupFormValidations = function() {
    const nombreInput = document.getElementById('cedula_nombre');
    const firmaNombreInput = document.getElementById('cedula_firma_nombre');
    
    if(nombreInput && firmaNombreInput) {
        firmaNombreInput.setAttribute('readonly', 'true');
        firmaNombreInput.style.backgroundColor = '#f0f0f0';
        firmaNombreInput.style.cursor = 'not-allowed';
        nombreInput.addEventListener('input', (e) => {
            firmaNombreInput.value = e.target.value;
        });
    }

    const setValid = (el, isValid, msg) => {
        if(!el) return;
        if(el.value.trim() === '') { el.style.borderColor = '#ccc'; return; }
        if(isValid) {
            el.style.borderColor = '#28a745'; el.style.backgroundColor = '#f8fff9'; el.title = '';
        } else {
            el.style.borderColor = '#dc3545'; el.style.backgroundColor = '#fff8f8'; el.title = msg;
        }
    };

    document.getElementById('cedula_telefono')?.addEventListener('input', (e) => 
        setValid(e.target, /^\d{10}$/.test(e.target.value), "Debe tener exactamente 10 dígitos numéricos"));

    document.getElementById('cedula_curp')?.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
        setValid(e.target, /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(e.target.value), "Estructura de CURP inválida (18 caracteres)");
    });

    document.getElementById('cedula_clave_elector')?.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
        setValid(e.target, /^[A-Z0-9]{18}$/.test(e.target.value), "Debe tener 18 caracteres alfanuméricos");
    });

    document.getElementById('cedula_seccion')?.addEventListener('input', (e) => 
        setValid(e.target, /^\d{1,4}$/.test(e.target.value), "La sección debe ser un número de hasta 4 dígitos"));
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.setupFormValidations);
} else {
    window.setupFormValidations();
}

window.checkForDuplicates = function(curp, clave) {
    if (!window.CRM.APP.circles) return null;
    for (const c of window.CRM.APP.circles) {
        if (!c.cedulas) continue;
        for (const m of c.cedulas) {
            if (curp && m.curp === curp) return `La CURP ya está registrada en el círculo: "${c.acta.nombre}" (${c.acta.estado}).`;
            if (clave && m.clave_elector === clave) return `La Clave de Elector ya está registrada en: "${c.acta.nombre}" (${c.acta.estado}).`;
        }
    }
    if (window.CRM.currentCircle && window.CRM.currentCircle.cedulas) {
         for (const m of window.CRM.currentCircle.cedulas) {
            if (curp && m.curp === curp) return `Esta CURP ya fue agregada hace un momento a este mismo círculo.`;
            if (clave && m.clave_elector === clave) return `Esta Clave de Elector ya fue agregada a este mismo círculo.`;
         }
    }
    return null;
};

window.checkPhoneDuplicate = function(tel) {
    if (!window.CRM.APP.circles) return null;
    for (const c of window.CRM.APP.circles) {
        if (!c.cedulas) continue;
        for (const m of c.cedulas) {
            if (tel && m.telefono === tel) return `El número ${tel} ya está vinculado a: ${m.nombre} en el círculo "${c.acta.nombre}".`;
        }
    }
    return null;
};

// ======================================================
// 3. RENDERIZADO DE OPCIONES
// ======================================================

window.renderCircleOptions = function() {
    const causesGrid = document.getElementById('causesGrid');
    if (causesGrid) {
        causesGrid.innerHTML = CAUSAS_LIST.map(c => `
            <label class="option-card">
                <input type="checkbox" name="causa" value="${c}" onchange="checkLimit(this, 'causa', 3)">
                <span>${c}</span>
            </label>
        `).join('');
    }

    const actGrid = document.getElementById('activitiesGrid');
    if (actGrid) {
        actGrid.innerHTML = ACTIVIDADES_LIST.map(a => `
            <label class="option-card">
                <input type="checkbox" name="actividad" value="${a}" onchange="checkLimit(this, 'actividad', 3)">
                <span>${a}</span>
            </label>
        `).join('');
    }
};

window.checkLimit = function(checkbox, name, limit) {
    const checked = document.querySelectorAll(`input[name="${name}"]:checked`);
    let btnId = name === 'actividad' ? 'btnActivitiesContinue' : 'btnCausesContinue';
    let counterId = name === 'actividad' ? 'countActivities' : 'countCauses';

    if (checked.length > limit) {
        checkbox.checked = false;
        alert(`Máximo ${limit} options.`);
        return;
    }
    
    if(document.getElementById(counterId)) document.getElementById(counterId).textContent = checked.length;
    if(document.getElementById(btnId)) document.getElementById(btnId).disabled = (checked.length === 0);
};

// ======================================================
// 4. NÚCLEO DE PERMISOS
// ======================================================

window.getAccessibleData = function() {
    const user = window.CRM.currentUser;
    if (!user) return { circles: [], users: [] };

    const allCircles = window.CRM.APP.circles || [];
    const allUsers   = window.CRM.APP.users   || [];

    // Normalización case-insensitive para comparar estado
    const normEdo = s => (s || '').trim().toLowerCase();
    const userEdo = normEdo(user.estado);

    // ── Nivel 1: visibilidad nacional total ──────────────────────────────
    if (window.hasPermission('view_all_users') || user.rol === 'validacion') {
        if (window.CRM._filterNacionalOnly) {
            const nacUsers = allUsers.filter(u =>
                window.hasPermission('view_all_users') ||
                u.rol === 'validacion' ||
                u.rol.startsWith('titular_nacional_') ||
                u.estado === 'Nacional'
            );
            return { circles: allCircles, users: nacUsers };
        }
        return { circles: allCircles, users: allUsers };
    }

    // ── Nivel 2: roles a nivel estado (ven todos los círculos de su estado) ─
    // Fix v15.25: comparación case-insensitive + incluye todos los delegados estatales
    const ROLES_NIVEL_ESTADO = [
        'secretario_estatal',
        'delegado_estatal_jovenes',
        'delegado_estatal_mujeres',
        'delegado_estatal_trabajadores',
        'delegado_estatal_fundacion',
        'delegado_estatal_productores',
        'delegado_estatal_migrante_usa',
        'coordinador_estatal_usa',
    ];
    if (ROLES_NIVEL_ESTADO.includes(user.rol)) {
        return {
            circles: allCircles.filter(c => normEdo(c.acta?.estado) === userEdo),
            users:   allUsers.filter(u   => normEdo(u.estado)        === userEdo)
        };
    }

    // ── Nivel 3: secretario_municipal (estado + municipio) ───────────────
    if (user.rol === 'secretario_municipal') {
        if (!user.municipio) return { circles: [], users: [user] };
        const miMun = user.municipio.toLowerCase().trim();
        return {
            circles: allCircles.filter(c =>
                normEdo(c.acta?.estado) === userEdo &&
                (c.acta?.municipio || '').toLowerCase().trim() === miMun
            ),
            users: allUsers.filter(u =>
                normEdo(u.estado) === userEdo &&
                (u.municipio || '').toLowerCase().trim() === miMun
            )
        };
    }

    // ── Nivel 4: coordinadores distritales (solo sus círculos propios) ───
    if (['coordinador_distrital_federal', 'coordinador_distrital_local'].includes(user.rol)) {
        return { circles: allCircles.filter(c => c.coordinador_usuario === user.usuario), users: [user] };
    }

    // ── Nivel 5: titulares nacionales de movimiento (su sector en todo el país) ─
    if (user.rol.startsWith('titular_nacional_')) {
        const sector = user.rol.replace('titular_nacional_', '');
        if (sector === 'migrante') {
            const sectorUsers = allUsers.filter(u => u.rol === 'coordinador_estatal_usa');
            const uNames = [...sectorUsers.map(u => u.usuario), user.usuario];
            return { circles: allCircles.filter(c => uNames.includes(c.coordinador_usuario)), users: sectorUsers };
        }
        const sectorUsers = allUsers.filter(u => u.rol.includes(sector));
        const uNames = [...sectorUsers.map(u => u.usuario), user.usuario];
        return { circles: allCircles.filter(c => uNames.includes(c.coordinador_usuario)), users: sectorUsers };
    }

    // ── Catch-all: rol municipal/local/invitado — solo sus propios círculos ─
    return { circles: allCircles.filter(c => c.coordinador_usuario === user.usuario), users: [user] };
};

// ======================================================
// 5. FLUJO DE CREACIÓN DE CÍRCULOS
// ======================================================

function _fillMunicipiosActa(estado) {
    const munSel = document.getElementById('acta_municipio');
    if (!munSel) return;
    if (!estado) {
        munSel.innerHTML = '<option value="">Selecciona un Estado primero</option>';
        munSel.disabled = true;
        return;
    }
    const cat = window.CATALOGO_MUNICIPIOS;
    const lista = (cat && cat[estado]) ? cat[estado] : [];
    const frag = document.createDocumentFragment();
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = lista.length ? 'Selecciona Municipio' : 'Cargando...';
    frag.appendChild(ph);
    lista.forEach(m => {
        const o = document.createElement('option');
        o.value = o.textContent = m;
        frag.appendChild(o);
    });
    munSel.innerHTML = '';
    munSel.appendChild(frag);
    munSel.disabled = false;
}

function populateActaStates() {
    const select = document.getElementById('acta_estado');
    if (!select) return;
    const frag = document.createDocumentFragment();
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = 'Selecciona Estado';
    frag.appendChild(ph);
    ESTADOS_MX_CIRCLES.forEach(edo => {
        const opt = document.createElement('option');
        opt.value = edo; opt.textContent = edo;
        frag.appendChild(opt);
    });
    select.innerHTML = '';
    select.appendChild(frag);
    select.onchange = function() { _fillMunicipiosActa(this.value); };
}

function prepareActaForm(type) {
    window.CRM.tempCircleData = { tipo: type };
    const isLudico = (type === 'ludico');
    const gridId = isLudico ? 'activitiesGrid' : 'causesGrid';
    const inputName = isLudico ? 'actividad' : 'causa';
    const modalToClose = isLudico ? 'modalSelectActivities' : 'modalSelectCauses';

    const checks = document.querySelectorAll(`#${gridId} input[name="${inputName}"]:checked`);
    const selection = Array.from(checks).map(c => c.value);

    if (isLudico) window.CRM.tempCircleData.actividades = selection;
    else window.CRM.tempCircleData.causas = selection;

    window.closeModal(modalToClose);
    populateActaStates();

    let user = window.CRM.currentUser;
    
    if (window.CRM.APP && window.CRM.APP.users) {
        const freshUser = window.CRM.APP.users.find(u => u.usuario === user.usuario);
        if (freshUser) {
            user = freshUser; 
        }
    }

    document.getElementById('acta_coordinador').value = user.nombre;
    document.getElementById('acta_whatsapp').value = user.whatsapp || '';
    const _nowActa = new Date();
    const _localFecha = `${_nowActa.getFullYear()}-${String(_nowActa.getMonth()+1).padStart(2,'0')}-${String(_nowActa.getDate()).padStart(2,'0')}`;
    document.getElementById('acta_fecha').value = _localFecha;

    const estadoSelect = document.getElementById('acta_estado');
    const municipioInput = document.getElementById('acta_municipio');

    const tienePasaporte = (user.multiestatal === true || user.multiestatal == 1 || user.multiestatal === "1");

    if (user.estado && user.estado !== "Nacional" && !tienePasaporte) {
        estadoSelect.value = user.estado;
        estadoSelect.setAttribute('disabled', 'true');
        _fillMunicipiosActa(user.estado);
        if (user.municipio) setTimeout(() => { municipioInput.value = user.municipio; }, 50);
    } else {
        estadoSelect.removeAttribute('disabled');
        estadoSelect.value = (user.estado && user.estado !== "Nacional") ? user.estado : "";
        if (estadoSelect.value) _fillMunicipiosActa(estadoSelect.value);
    }

    window.openModal('modalActa');
}

window.handleActivitiesContinue = function() { prepareActaForm('ludico'); };
window.handleCausesContinue = function() { prepareActaForm('causas'); };

// 🔥 EL PERRO GUARDIÁN MODO RESCATE (Para iOS / Acceso Directo) 🔥
window.getCurrentLocation = function(latId, lngId) {
    if (!navigator.geolocation) return alert("Geolocalización no soportada por el navegador.");
    
    const btn = document.activeElement;
    const actualBtn = (btn && btn.tagName === 'BUTTON') ? btn : null;

    if(actualBtn) {
        actualBtn.textContent = "📡 Buscando...";
        actualBtn.disabled = true;
    }
    
    // Si el iPhone (o cualquier celular) se bloquea y no responde en 8 segundos...
    const fallbackTimeout = setTimeout(() => {
        if(actualBtn && actualBtn.textContent === "📡 Buscando...") {
            const saltar = confirm("⚠️ El sistema (o tu iPhone) está bloqueando la señal GPS.\n\n¿Deseas activar el MODO RESCATE y continuar sin GPS para no perder tu acta?");
            
            if(saltar) {
                // Inyectamos ceros para brincar la validación y rescatar al usuario
                document.getElementById(latId).value = "0.000000";
                document.getElementById(lngId).value = "0.000000";
                actualBtn.textContent = "✅ GPS Omitido (Rescate)";
                actualBtn.style.background = "#ffc107";
                actualBtn.style.color = "#000";
                actualBtn.disabled = false;
            } else {
                actualBtn.textContent = "📡 Reintentar GPS";
                actualBtn.disabled = false;
            }
        }
    }, 8000); 

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            clearTimeout(fallbackTimeout); 
            document.getElementById(latId).value = pos.coords.latitude.toFixed(6);
            document.getElementById(lngId).value = pos.coords.longitude.toFixed(6);
            if(actualBtn) {
                actualBtn.textContent = "✅ Ubicación guardada";
                actualBtn.style.background = "#28a745";
                actualBtn.style.color = "#fff";
                actualBtn.disabled = false;
            }
        },
        (err) => {
            clearTimeout(fallbackTimeout); 
            // Si tira error explícito, aplicamos la misma lógica de rescate automático
            document.getElementById(latId).value = "0.000000";
            document.getElementById(lngId).value = "0.000000";
            
            alert("⚠️ Error de GPS: " + err.message + "\n\nSe activó el 'Modo Rescate' automático para que puedas guardar tu acta de todos modos.");
            
            if(actualBtn) {
                actualBtn.textContent = "✅ GPS Omitido (Rescate)";
                actualBtn.style.background = "#ffc107";
                actualBtn.style.color = "#000";
                actualBtn.disabled = false;
            }
        },
        { 
            enableHighAccuracy: true, 
            timeout: 8000, 
            maximumAge: 0 
        }
    );
};

window.handleGeneratePDFAndSave = async function(e) {
    e.preventDefault();
    const form = document.getElementById('formActa');
    if (!form.reportValidity()) return;

    // 🔥 CANDADO GPS ESTRICTO (Pero que respeta el Modo Rescate con "0.000000") 🔥
    const lat = document.getElementById('acta_lat').value;
    const lng = document.getElementById('acta_lng').value;
    if (!lat || !lng) {
        alert("📍 ¡Falta la ubicación exacta!\n\nPor favor, presiona el botón naranja '📡 Obtener mi ubicación actual' para registrar las coordenadas antes de continuar. Es obligatorio.");
        return;
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "Procesando...";

    const estadoSelect = document.getElementById('acta_estado');
    const estadoFinal = estadoSelect.value || window.CRM.currentUser.estado;

    const actaData = {
        nombre: document.getElementById('acta_nombre').value.toUpperCase(),
        estado: estadoFinal,
        municipio: document.getElementById('acta_municipio').value.toUpperCase(),
        seccion: document.getElementById('acta_seccion')?.value?.trim() || '',
        fecha: document.getElementById('acta_fecha').value,
        hora: new Date().toLocaleTimeString('es-MX', {hour: '2-digit', minute: '2-digit', hour12: false}),
        coordinador: document.getElementById('acta_coordinador').value,
        whatsapp: document.getElementById('acta_whatsapp').value,
        lat: lat,
        lng: lng
    };

    window.CRM.currentCircle = {
        ...window.CRM.tempCircleData,
        unique_id: `C-${Date.now()}-${Math.floor(Math.random()*1000)}`, // Generamos ID local preventivo para modo offline
        acta: actaData,
        cedulas: [],
        coordinador_usuario: window.CRM.currentUser.usuario,
        timestamp: new Date().toISOString(),
        status: 'pendiente'
    };
    
    window.CRM.isEditingCircle = false;
    
    document.getElementById('currentCircleName').textContent = actaData.nombre;
    window.closeModal('modalActa');
    
    document.getElementById('formCedula').reset();
    document.getElementById('cedula_foto_opcional').value = "";
    document.getElementById('cedula_ine').value = "";
    window.CRM._ineBase64 = null;
    const fotoOpc = document.getElementById('cedula_foto_opcional');
    if (fotoOpc) fotoOpc._compressedBase64 = null;

    // Reiniciar contador de integrantes a 1
    const contadorSpan = document.getElementById('contadorMiembrosActuales');
    if (contadorSpan) contadorSpan.textContent = "1";
    if (window.actualizarBarraProgreso) window.actualizarBarraProgreso(1);
    
    const canvas = document.getElementById('sigCanvas');
    if(canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height); }
    
    const preview = document.getElementById('cedula_ine_preview');
    if(preview) { preview.src = ''; preview.style.display = 'none'; }
    
    window.setupFormValidations();

    document.getElementById('btnNextIntegrante').textContent = "Guardar Cédula y Registrar Otro";
    document.getElementById('btnFinalizarCirculo').textContent = "Finalizar Registro del Círculo";

    window.openModal('modalCedula');
    // Verificar si ya hay un coordinador designado al abrir el modal
    setTimeout(() => window.actualizarCheckboxCoordinador(), 80);
    btn.disabled = false; btn.textContent = "Guardar Acta y Continuar";
};

// ======================================================
// 5a. SUMAR INTEGRANTE A CÍRCULO EXISTENTE
// ======================================================

window.abrirAgregarIntegrante = async function(idx) {
    const btn = event?.target;
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Cargando..."; }

    try {
        // Cargar datos completos del círculo (fotos, etc.)
        let circle = window.CRM.APP.circles[idx];
        if (window.fetchCircleFullDetails) {
            circle = await window.fetchCircleFullDetails(idx);
        }

        // Establecer como círculo activo en modo edición
        window.CRM.currentCircle   = circle;
        window.CRM.isEditingCircle = true;

        // Limpiar el formulario de cédula completamente
        document.getElementById('formCedula').reset();
        document.getElementById('cedula_foto_opcional').value = "";
        document.getElementById('cedula_ine').value = "";
        window.CRM._ineBase64 = null;
        const fotoOpc = document.getElementById('cedula_foto_opcional');
        if (fotoOpc) fotoOpc._compressedBase64 = null;

        // Canvas firma
        const canvas = document.getElementById('sigCanvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        // Preview INE
        const preview = document.getElementById('cedula_ine_preview');
        if (preview) { preview.src = ''; preview.style.display = 'none'; }

        // Actualizar encabezado del círculo
        document.getElementById('currentCircleName').textContent = circle.acta.nombre;

        // Contador: apunta al siguiente integrante a registrar
        const yaRegistrados = circle.cedulas?.length || 0;
        const siguienteNum  = Math.min(yaRegistrados + 1, 18);
        const contadorSpan  = document.getElementById('contadorMiembrosActuales');
        if (contadorSpan) contadorSpan.textContent = siguienteNum;
        if (window.actualizarBarraProgreso) window.actualizarBarraProgreso(siguienteNum);

        // Textos de botones para modo edición
        document.getElementById('btnNextIntegrante').textContent   = "✅ Guardar y Agregar Otro";
        document.getElementById('btnFinalizarCirculo').textContent = "💾 Guardar Cambios y Cerrar";

        // Banner de modo edición
        const banner = document.getElementById('edit-mode-banner');
        if (banner) {
            banner.style.display = 'flex';
            const nameEl  = document.getElementById('edit-circle-name-banner');
            const countEl = document.getElementById('edit-member-count-banner');
            if (nameEl)  nameEl.textContent  = circle.acta.nombre;
            if (countEl) countEl.textContent = yaRegistrados;
        }

        window.setupFormValidations();
        window.openModal('modalCedula');
        setTimeout(() => window.actualizarCheckboxCoordinador(), 80);

        // Cerrar el listado de círculos para que el modal de cédula sea el foco
        window.closeModal('modalCircleList');

    } catch(e) {
        alert("⚠️ Error al cargar el Círculo: " + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "➕ Sumar Integrante"; }
    }
};

// ======================================================
// 5b. CONTROL DE COORDINADOR ÚNICO
// ======================================================

window.actualizarCheckboxCoordinador = function() {
    const cedulas = window.CRM.currentCircle?.cedulas || [];
    const coordExistente = cedulas.find(c => c.es_coordinador);

    const wrapper   = document.getElementById('coordinador-checkbox-wrapper');
    const msgDiv    = document.getElementById('coordinador-ya-designado');
    const nombreSpan = document.getElementById('coordinador-nombre-actual');

    if (coordExistente) {
        // Ya hay coordinador → ocultar checkbox, mostrar mensaje
        if (wrapper)    wrapper.style.display   = 'none';
        if (msgDiv)     msgDiv.style.display     = 'block';
        if (nombreSpan) nombreSpan.textContent   = coordExistente.nombre;
        // Asegurarse de que el checkbox quede desmarcado
        const cb = document.getElementById('cedula_es_coordinador');
        if (cb) cb.checked = false;
    } else {
        // Sin coordinador → mostrar checkbox, ocultar mensaje
        if (wrapper)    wrapper.style.display   = 'block';
        if (msgDiv)     msgDiv.style.display     = 'none';
        if (nombreSpan) nombreSpan.textContent   = '';
    }
};

// ======================================================
// 6. GESTIÓN DE INTEGRANTES CON COMPRESIÓN
// ======================================================

async function extractCedulaData() {
    const getVal = (id) => document.getElementById(id).value.trim();
    
    const nombre = getVal('cedula_nombre');
    const telefono = getVal('cedula_telefono');
    const curp = getVal('cedula_curp').toUpperCase();
    const claveElector = getVal('cedula_clave_elector').toUpperCase();
    const seccion = getVal('cedula_seccion');
    
    if (!nombre) throw new Error("El Nombre Completo es obligatorio.");
    if (!document.getElementById('cedula_op_integrar').checked)
        throw new Error("⚠️ Debes seleccionar la opción 'Me gustaría integrar un Círculo Ciudadano' para continuar.");
    if (!/^\d{10}$/.test(telefono)) throw new Error("El Teléfono debe tener exactamente 10 dígitos numéricos.");
    if (curp && !/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(curp)) throw new Error("La CURP tiene un formato inválido (18 caracteres).");
    if (claveElector && !/^[A-Z0-9]{18}$/.test(claveElector)) throw new Error("La Clave de Elector debe tener 18 caracteres.");
    if (seccion && !/^\d{1,4}$/.test(seccion)) throw new Error("La Sección Electoral debe ser un número de hasta 4 dígitos.");

    const duplicateError = window.checkForDuplicates(curp, claveElector);
    if (duplicateError) throw new Error("⛔ REGISTRO DUPLICADO:\n" + duplicateError);

    // Validar unicidad del Coordinador
    const quiereSerCoord = document.getElementById('cedula_es_coordinador').checked;
    if (quiereSerCoord) {
        const cedulas = window.CRM.currentCircle?.cedulas || [];
        const coordExistente = cedulas.find(c => c.es_coordinador);
        if (coordExistente) {
            throw new Error(`⛔ Ya existe un(a) Coordinador(a) designado(a) en este Círculo:\n"${coordExistente.nombre}"\n\nSolo puede haber uno(a) por Círculo Ciudadano.`);
        }
    }

    const phoneWarning = window.checkPhoneDuplicate(telefono);
    if (phoneWarning) {
        if (!confirm(`⚠️ AVISO:\n${phoneWarning}\n\n¿Estás seguro de que esta persona comparte el mismo número celular?`)) {
            throw new Error("Registro cancelado por teléfono duplicado.");
        }
    }

    const ineInput = document.getElementById('cedula_ine');
    const fotoInput = document.getElementById('cedula_foto_opcional');

    let ineBase64 = null, fotoBase64 = null;

    // ── INE: primero usar imagen ya procesada por el módulo OCR v8.0;
    //         si no, comprimir el archivo subido directamente (flujo heredado).
    if (window.CRM._ineBase64) {
        ineBase64 = window.CRM._ineBase64;
    } else if (ineInput.files[0]) {
        const raw = await window.fileToBase64(ineInput.files[0]);
        ineBase64 = (await window.compressToLimits(raw, window.IMG_LIMITS.ine)).b64;
    } else {
        throw new Error("Debes capturar o subir la foto del INE.");
    }

    // ── Foto de perfil: usar versión ya comprimida por handleProfilePhotoSelect,
    //                    o comprimir el archivo si se subió directamente.
    if (fotoInput._compressedBase64) {
        fotoBase64 = fotoInput._compressedBase64;
    } else if (fotoInput.files[0]) {
        const raw = await window.fileToBase64(fotoInput.files[0]);
        fotoBase64 = (await window.compressToLimits(raw, window.IMG_LIMITS.profile)).b64;
    } else {
        fotoBase64 = ineBase64;
    }
    
    const canvas = document.getElementById('sigCanvas');
    let firmaData = null;
    
    if (canvas && !isCanvasBlank(canvas)) {
        firmaData = canvas.toDataURL('image/png', 0.5); // Comprimir firma
    } else {
        const fNombre = getVal('cedula_firma_nombre');
        const fCurp = getVal('cedula_firma_curp');
        if(fNombre && fCurp.length === 18) {
            firmaData = `DIGITAL:${fNombre}|${fCurp}`;
        } else {
            throw new Error("Firma requerida (Dibuja o usa Firma Digital con CURP).");
        }
    }

    return {
        nombre: nombre.toUpperCase(),
        telefono: telefono,
        domicilio: getVal('cedula_domicilio').toUpperCase(),
        clave_elector: claveElector,
        curp: curp,
        fecha_nacimiento: getVal('cedula_fecha_nacimiento'),
        seccion: seccion,
        sexo: getVal('cedula_sexo'),
        email:          getVal('cedula_email'),
        instagram:      getVal('cedula_instagram'),
        facebook:       getVal('cedula_facebook'),
        red_x:          getVal('cedula_x'),
        tiktok:         getVal('cedula_tiktok'),
        anio_registro:  getVal('cedula_anio_registro'),
        vigencia_ine:   getVal('cedula_vigencia_ine'),
        es_coordinador: document.getElementById('cedula_es_coordinador').checked,
        opciones_afiliacion: {
            afiliacion: document.getElementById('cedula_op_afiliacion').checked,
            info: document.getElementById('cedula_op_info').checked,
            integrar: document.getElementById('cedula_op_integrar').checked,
            candidato: document.getElementById('cedula_op_candidato').checked
        },
        ine_data: ineBase64,
        foto_perfil: fotoBase64,
        firma: firmaData,
        fecha_registro: new Date().toISOString()
    };
}

window.handleNextIntegrante = async function() {
    const btn = document.getElementById('btnNextIntegrante');
    btn.disabled = true; btn.textContent = "Comprimiendo y Guardando...";

    try {
        const integrante = await extractCedulaData();
        window.CRM.currentCircle.cedulas.push(integrante);

        const totalNow = window.CRM.currentCircle.cedulas.length;

        // En modo edición: auto-guardar en la nube inmediatamente tras cada integrante
        if (window.CRM.isEditingCircle) {
            btn.textContent = "☁️ Sincronizando...";
            try {
                await window.saveCircleToCloud(window.CRM.currentCircle);
            } catch(e) {
                console.warn('Auto-save en modo edición falló:', e.message);
            }
            // Actualizar contador del banner de edición
            const countEl = document.getElementById('edit-member-count-banner');
            if (countEl) countEl.textContent = totalNow;
        }

        alert(`✅ Integrante guardado.\nTotal en este Círculo: ${totalNow} integrante(s).`);

        document.getElementById('formCedula').reset();
        document.getElementById('cedula_foto_opcional').value = "";
        document.getElementById('cedula_ine').value = "";
        // ── Fix foto persistente: limpiar propiedades custom del input ──
        window.CRM._ineBase64 = null;
        const _fotoOpcReset = document.getElementById('cedula_foto_opcional');
        if (_fotoOpcReset) _fotoOpcReset._compressedBase64 = null;
        const _fotoPreviewReset = document.getElementById('cedula_foto_preview');
        if (_fotoPreviewReset) { _fotoPreviewReset.src = ''; _fotoPreviewReset.style.display = 'none'; }
        const _fotoBadgeReset = document.getElementById('cedula_foto_badge');
        if (_fotoBadgeReset) _fotoBadgeReset.style.display = 'none';

        const preview = document.getElementById('cedula_ine_preview');
        if(preview) { preview.src = ''; preview.style.display = 'none'; }

        const canvas = document.getElementById('sigCanvas');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0,canvas.width,canvas.height);

        window.setupFormValidations();
        window.actualizarCheckboxCoordinador();
        document.querySelector('.modal-content').scrollTop = 0;

        // Actualizar contador visual y barra de progreso
        const contadorSpan = document.getElementById('contadorMiembrosActuales');
        if (contadorSpan) {
            const nextNum = totalNow + 1;
            contadorSpan.textContent = nextNum <= 18 ? nextNum : 18;
            if (window.actualizarBarraProgreso) window.actualizarBarraProgreso(nextNum);
        }

    } catch (err) {
        alert("⚠️ " + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = window.CRM.isEditingCircle ? "✅ Guardar y Agregar Otro" : "Guardar Cédula y Registrar Otro";
    }
};

// ==========================================
// 7. FINALIZAR Y GUARDADO INTELIGENTE
// ==========================================

window.handleFinalizarCirculo = async function() {
    const nombrePendiente = document.getElementById('cedula_nombre').value.trim();
    if (nombrePendiente !== '') {
        if (confirm("Hay un integrante escrito pero NO guardado. ¿Deseas guardarlo antes de finalizar?")) {
            try {
                const integrante = await extractCedulaData();
                window.CRM.currentCircle.cedulas.push(integrante);
            } catch(e) {
                return alert("Corrige los datos del último integrante: " + e.message);
            }
        }
    }

    if (!window.CRM.currentCircle || window.CRM.currentCircle.cedulas.length < 6) {
        return alert("⚠️ El Círculo Ciudadano debe tener mínimo 6 integrantes registrados.\nActualmente llevas " + (window.CRM.currentCircle?.cedulas?.length || 0) + ".");
    }

    const btn = document.getElementById('btnFinalizarCirculo');
    btn.disabled = true; btn.textContent = "Finalizando Documento...";

    try {
        if (window.CRM.isEditingCircle) {
            window.CRM.currentCircle.updated_at = new Date().toISOString();
        }

        const esEdicion = window.CRM.isEditingCircle;

        // En edición: solo guardamos en nube (sin regenerar PDF si ya se sincronizó con auto-save)
        if (esEdicion) {
            await window.saveCircleToCloud(window.CRM.currentCircle);
            const totalFinal = window.CRM.currentCircle.cedulas.length;
            alert(`✅ ¡Círculo actualizado correctamente!\nTotal de integrantes: ${totalFinal}`);
        } else {
            // Flujo nuevo: generar PDF + guardado inteligente
            if (window.generateCirclePDF) {
                await window.generateCirclePDF(window.CRM.currentCircle);
            }
            await window.handleSmartSave(window.CRM.currentCircle);
        }

        // Ocultar banner de edición
        const banner = document.getElementById('edit-mode-banner');
        if (banner) banner.style.display = 'none';

        window.closeModal('modalCedula');
        window.CRM.currentCircle    = null;
        window.CRM.isEditingCircle  = false;

        // Limpiar formularios
        document.getElementById('formActa').reset();
        document.getElementById('formCedula').reset();
        if (window.applyCircleListFilters) window.applyCircleListFilters();

        // Re-abrir listado si estábamos en edición
        if (esEdicion) window.openModal('modalCircleList');

    } catch (err) {
        console.error(err);
        alert("⚠️ Error al guardar: " + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = window.CRM.isEditingCircle ? "💾 Guardar Cambios y Cerrar" : "Finalizar Registro del Círculo";
    }
};

window.handleSmartSave = async function(circleData) {
    // Si hay internet y el semáforo NO está en rojo, intentamos subirlo directo
    if (navigator.onLine && window.CRM.serverStatus !== 'red') {
        try {
            if (typeof window.saveCircleToCloud === 'function') {
                await window.saveCircleToCloud(circleData);
                alert("🎉 ¡Círculo guardado en la nube exitosamente!");
                
                // Actualizamos visualmente la tabla
                if(!window.CRM.APP.circles.find(c => c.unique_id === circleData.unique_id)) {
                    window.CRM.APP.circles.unshift(circleData);
                }
                return true;
            }
        } catch (error) {
            console.warn("Servidor rechazó el paquete directo, enviando a banda transportadora...", error);
        }
    }
    
    // Si el servidor falló o no hay internet, va a la banda transportadora local
    if (typeof window.queueOfflineCircle === 'function') {
        return window.queueOfflineCircle(circleData);
    } else {
        alert("Error grave: Falla de red y módulo offline no encontrado.");
    }
};

function isCanvasBlank(canvas) {
    if(!canvas) return true;
    const context = canvas.getContext('2d');
    const pixelBuffer = new Uint32Array(context.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
    return !pixelBuffer.some(color => color !== 0);
}

// ======================================================
// 8. LISTADO, BUSCADOR AVANZADO Y HUÉRFANOS
// ======================================================

window.showCircleList = function() {
    window.openModal('modalCircleList');
    
    const user = window.CRM.currentUser;
    if (user && window.hasPermission('delete_items')) {
        const btnGroup = document.querySelector('#btnRescateCirculos')?.parentElement;
        if(btnGroup && !document.getElementById('btnFiltroHuerfanos')) {
            const btnHuerfanos = document.createElement('button');
            btnHuerfanos.id = 'btnFiltroHuerfanos';
            btnHuerfanos.className = 'secondary-btn small-btn';
            btnHuerfanos.style.cssText = 'background:#ff9800; color:white; font-weight:bold; margin:0; width:100%;';
            btnHuerfanos.textContent = '👻 Filtro Huérfanos';
            btnHuerfanos.onclick = window.toggleFiltroHuerfanos;
            btnGroup.appendChild(btnHuerfanos);
        }
    }
    
    const select = document.getElementById('circleList_state_select');
    if (select && select.options.length <= 1) {
         select.innerHTML = '<option value="">Todos los Estados</option>';
         ESTADOS_MX_CIRCLES.forEach(e => select.innerHTML += `<option value="${e}">${e}</option>`);
    }

    const selectCause = document.getElementById('circleList_cause_select');
    if (selectCause && selectCause.options.length <= 1) {
        selectCause.innerHTML = '<option value="">Todas las Causas/Temas</option>';
        
        const optGroupCausas = document.createElement('optgroup');
        optGroupCausas.label = "Causas Sociales";
        CAUSAS_LIST.forEach(c => optGroupCausas.innerHTML += `<option value="${c}">${c}</option>`);
        
        const optGroupActividades = document.createElement('optgroup');
        optGroupActividades.label = "Actividades Lúdicas";
        ACTIVIDADES_LIST.forEach(a => optGroupActividades.innerHTML += `<option value="${a}">${a}</option>`);
        
        selectCause.appendChild(optGroupCausas);
        selectCause.appendChild(optGroupActividades);
    }

    window.applyCircleListFilters();
};

window.toggleFiltroHuerfanos = function() {
    window.CRM._filterOrphansOnly = !window.CRM._filterOrphansOnly;
    const btn = document.getElementById('btnFiltroHuerfanos');
    if(window.CRM._filterOrphansOnly) {
        btn.style.background = '#e65100'; 
        btn.innerHTML = '🔙 Volver a Ver Todos'; 
    } else {
        btn.style.background = '#ff9800';
        btn.innerHTML = '👻 Filtrar Huérfanos';
    }
    window.applyCircleListFilters();
};

window.onCircleListStateChange = function(stateVal) {
    const munSel = document.getElementById('circleList_municipio_select');
    if (munSel) {
        munSel.innerHTML = '<option value="">Todos los Municipios</option>';
        if (stateVal && window.popularMunicipios) window.popularMunicipios(stateVal, 'circleList_municipio_select');
    }
    window.applyCircleListFilters();
};

window.applyCircleListFilters = function() {
    const tbody = document.getElementById('circleListTbody');
    if(!tbody) return;

    const { circles } = window.getAccessibleData();

    const dashboardFilter = document.getElementById('dashboardStateFilter')?.value;
    const filterState = document.getElementById('circleList_state_select')?.value;
    const filterCause = document.getElementById('circleList_cause_select')?.value;
    const filterDate = document.getElementById('circleList_date_select')?.value;
    const filterMunicipio = document.getElementById('circleList_municipio_select')?.value;
    const filterSeccion = document.getElementById('circleList_seccion_input')?.value?.trim() || '';

    const rawSearch = document.getElementById('circleList_search')?.value || "";
    const searchInput = rawSearch.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    let displayCircles = circles;

    if (window.CRM._filterOrphansOnly) {
        displayCircles = displayCircles.filter(c => {
            const creator = window.CRM.APP.users.find(u => u.usuario === c.coordinador_usuario);
            if (!creator) return true; 
            
            const cEstado = (c.acta.estado || "").trim().toLowerCase();
            const uEstado = (creator.estado || "").trim().toLowerCase();
            
            return uEstado !== cEstado;
        });
    }

    if (dashboardFilter && dashboardFilter !== "") {
        displayCircles = displayCircles.filter(c => c.acta.estado === dashboardFilter);
    }
    
    if (filterState && filterState !== "") {
        displayCircles = displayCircles.filter(c => c.acta.estado === filterState);
    }
    
    if (filterDate && filterDate !== "") {
        displayCircles = displayCircles.filter(c => c.acta.fecha === filterDate);
    }
    
    if (filterCause && filterCause !== "") {
        displayCircles = displayCircles.filter(c => {
            const causas = c.causas || [];
            const acts = c.actividades || [];
            return causas.includes(filterCause) || acts.includes(filterCause);
        });
    }

    if (filterMunicipio && filterMunicipio !== "") {
        displayCircles = displayCircles.filter(c =>
            (c.acta.municipio || '').toUpperCase() === filterMunicipio.toUpperCase()
        );
    }

    if (filterSeccion !== "") {
        displayCircles = displayCircles.filter(c => {
            if ((c.acta.seccion || '') === filterSeccion) return true;
            return c.cedulas?.some(m => (m.seccion || '') === filterSeccion);
        });
    }

    if (searchInput !== "") {
        displayCircles = displayCircles.filter(c => {
            const circName = (c.acta.nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            let coordName = (c.acta.coordinador || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const designated = c.cedulas?.find(m => m.es_coordinador === true);
            if(designated) {
                coordName = (designated.nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            }
            return circName.includes(searchInput) || coordName.includes(searchInput);
        });
    }

    if (displayCircles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px;">No se encontraron círculos con esos filtros. Intenta borrar algunos criterios.</td></tr>';
        return;
    }

    const user = window.CRM.currentUser;
    const canAudit        = ['admin', 'validacion', 'secretario_nacional'].includes(user.rol) || window.hasPermission('centro_mando');
    const canEditCircle   = window.hasPermission('edit_users') || ['secretario_estatal'].includes(user.rol);
    const canDeleteCircle = window.hasPermission('delete_items');

    let htmlString = "";
    const MAX_RENDER = 200; 
    let renderCount = 0;

    displayCircles.forEach((c) => {
        if(renderCount >= MAX_RENDER) return;

        const idx = window.CRM.APP.circles.indexOf(c);
        const date = new Date(c.acta.fecha || Date.now()).toLocaleDateString();
        const integranteCount = c.cedulas ? c.cedulas.length : 0;
        
        let statusBadge = '<span class="badge badge-yellow">Pendiente</span>';
        if (c.status === 'validado') statusBadge = '<span class="badge badge-green">Validado</span>';
        if (c.status === 'revision') statusBadge = '<span class="badge badge-red">Observado</span>';
        // 🔥 SEÑALIZACIÓN VISUAL DE OFFLINE 🔥
        if (c._isOffline) statusBadge = '<span class="badge badge-yellow" style="background:#0d47a1; color:white;">En Cola (No subido)</span>';

        let temasDisplay = c.causas?.length > 0 ? c.causas.join(', ') : (c.actividades?.length > 0 ? c.actividades.join(', ') : "Sin definir");
        let coordName = c.acta.coordinador || 'N/A';
        const designated = c.cedulas?.find(m => m.es_coordinador === true);
        if(designated) coordName = designated.nombre;

        const creatorSpan = `<br><small style="color:#ff9800;"><b>Capturó:</b> ${c.coordinador_usuario}</small>`;

        // Remarcar con color si está offline
        htmlString += `
            <tr ${c._isOffline ? 'style="background-color:#e3f2fd;"' : ''}>
                <td><strong>${c.acta.nombre}</strong><br><small>${date}</small></td>
                <td>${c.acta.estado || '<span style="color:red">Sin Estado</span>'}<br><small>${c.acta.municipio}</small></td>
                <td><small>${temasDisplay}</small></td>
                <td style="text-align:center; font-weight:bold;">${integranteCount}</td>
                <td>${window.toTitleCase(coordName)}${creatorSpan}</td>
                <td>${statusBadge}</td>
                <td style="min-width: 100px;">
                    <button class="secondary-btn small-btn" onclick="window.handleExportCirclePDF(${idx})" title="Descargar PDF" style="margin-bottom: 5px; width: 100%;">📄 PDF</button>
                    ${ !c._isOffline ? `<button class="secondary-btn small-btn" style="background:#1565c0; color:#fff; width: 100%; margin-bottom: 5px;" onclick="window.abrirBitacora(${idx})" title="Bitácora de Sesiones">📋 Bitácora (${c.sesiones?.length || 0})</button>` : '' }
                    ${ canEditCircle && !c._isOffline ? `<button class="secondary-btn small-btn" style="background:#0d47a1; color:#fff; width: 100%; margin-bottom: 5px;" onclick="window.abrirAgregarIntegrante(${idx})">➕ Sumar Integrante</button>` : '' }
                    ${ canDeleteCircle && !c._isOffline ? `<button class="secondary-btn small-btn" style="background:#8e24aa; color:#fff; width: 100%; margin-bottom: 5px;" onclick="window.reasignarCirculo(${idx})">🔄 Reasignar</button>` : '' }
                    ${ canAudit && !c._isOffline ? `<button class="secondary-btn small-btn" style="background:#333; color:#fff; width: 100%; margin-bottom: 5px;" onclick="window.abrirPanelValidacion(${idx})">🔍 Auditar</button>` : '' }
                    ${ canDeleteCircle && !c._isOffline
                        ? `<button class="secondary-btn small-btn" style="background:#dc3545;color:#fff;width:100%;" onclick="window.confirmDeleteCircle(${idx})">🗑️ Borrar Círculo</button>`
                        : (!c._isOffline && canEditCircle
                            ? `<button class="secondary-btn small-btn" style="background:#e65100;color:#fff;width:100%;font-size:10px;" onclick="window.solicitarBorrado('circulo','${c.unique_id || c._db_uid}','${(c.acta?.nombre||'Círculo').replace(/'/g,"\\'")}')">📤 Solicitar Borrado</button>`
                            : '') }
                </td>
            </tr>
        `;
        renderCount++;
    });

    if (displayCircles.length > MAX_RENDER) {
        htmlString += `<tr><td colspan="7" style="text-align:center; background:#fff3cd; color:#856404; padding:15px; border-radius: 8px;"><b>⚠️ Mostrando ${MAX_RENDER} de ${displayCircles.length} resultados.</b></td></tr>`;
    }

    tbody.innerHTML = htmlString;
};

// Función para Reasignar Círculos Huérfanos
window.reasignarCirculo = async function(idx) {
    const c = window.CRM.APP.circles[idx];
    const nuevoUserRaw = prompt(`Este círculo pertenece actualmente a: ${c.coordinador_usuario}\n\nPara transferir la propiedad, escribe el USUARIO (Login) del nuevo coordinador:`);
    if(!nuevoUserRaw) return;
    
    // Inmunidad a mayúsculas
    const nuevoUser = nuevoUserRaw.toLowerCase().trim();
    
    const userExiste = window.CRM.APP.users.find(u => u.usuario.toLowerCase() === nuevoUser);
    if(!userExiste) return alert("❌ Ese usuario no existe en el sistema. Verifica el nombre de usuario (Login).");
    
    const btn = document.activeElement;
    const originalText = btn ? btn.textContent : "";
    if(btn && btn.tagName === 'BUTTON') { btn.textContent = "⏳ Transfiriendo..."; btn.disabled = true; }
    
    try {
        let fullCircle = c;
        if(window.fetchCircleFullDetails) fullCircle = await window.fetchCircleFullDetails(idx);
        
        fullCircle.coordinador_usuario = userExiste.usuario;
        fullCircle.acta.coordinador = userExiste.nombre; // Actualizamos también el nombre en el acta visual
        
        await window.saveCircleToCloud(fullCircle);
        
        alert(`✅ Círculo reasignado exitosamente a ${userExiste.nombre}.\n\nSi el filtro de huérfanos está activo, este círculo desaparecerá de la vista porque ya tiene un dueño local.`);
        
        window.applyCircleListFilters();
        if (typeof window.updateStats === 'function') window.updateStats();
    } catch(e) {
        alert("Error al reasignar: " + e.message);
    } finally {
        if(btn && btn.tagName === 'BUTTON') { btn.textContent = originalText || "🔄 Reasignar"; btn.disabled = false; }
    }
};

window.confirmDeleteCircle = async function(idx) {
    if (!window.hasPermission('delete_items')) return alert("⛔ Acceso denegado. Solo el Alto Mando puede borrar círculos.");
    
    const c = window.CRM.APP.circles[idx];
    const intCount = c.cedulas ? c.cedulas.length : 0;
    
    if (!confirm(`⚠️ PELIGRO EXTREMO: ¿Estás seguro de borrar TODO el círculo "${c.acta.nombre}" junto con sus ${intCount} integrantes?\n\nEsta acción es definitiva.`)) return;

    try {
        if (typeof window.deleteCircleFromCloud === 'function') {
            await window.deleteCircleFromCloud(c);
        } else {
            window.CRM.APP.circles.splice(idx, 1);
        }
        
        alert("✅ Círculo eliminado exitosamente de la base de datos.");
        window.applyCircleListFilters();
        if (typeof window.updateStats === 'function') window.updateStats();
        
    } catch (e) {
        alert("Error al intentar borrar el círculo: " + e.message);
    }
};

window.mostrarCirculosPerdidos = function() {
    const user = window.CRM.currentUser;
    if (!user || !window.hasPermission('delete_items')) {
        return alert("⛔ Acceso Denegado. Solo el Alto Mando puede asignar círculos perdidos.");
    }

    const tbody = document.getElementById('circleListTbody');
    if(!tbody) return;
    tbody.innerHTML = '';

    const allCircles = window.CRM.APP.circles || [];
    const circulosPerdidos = allCircles.filter(c => !c.acta.estado || c.acta.estado.trim() === "");

    if (circulosPerdidos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: #28a745; font-weight: bold;">¡Excelente! No hay círculos perdidos en el limbo.</td></tr>';
        return;
    }

    alert(`⚠️ Se encontraron ${circulosPerdidos.length} círculos sin estado asignado.`);

    let htmlString = "";
    circulosPerdidos.forEach((c) => {
        const idx = window.CRM.APP.circles.indexOf(c);
        const date = new Date(c.acta.fecha || c.timestamp || Date.now()).toLocaleDateString();
        const integranteCount = c.cedulas ? c.cedulas.length : 0;
        
        let coordName = c.acta.coordinador || 'N/A';
        const designated = c.cedulas?.find(m => m.es_coordinador === true);
        if(designated) coordName = designated.nombre;

        htmlString += `
            <tr style="background-color: #fff3cd;">
                <td><strong>${c.acta.nombre || 'SIN NOMBRE'}</strong><br><small>${date}</small></td>
                <td style="color: red; font-weight: bold;">🔴 SIN ESTADO<br><small>${c.acta.municipio || 'Sin Municipio'}</small></td>
                <td><small>${c.causas?.length > 0 ? c.causas.join(', ') : "Sin definir"}</small></td>
                <td style="text-align:center; font-weight:bold;">${integranteCount}</td>
                <td>${window.toTitleCase(coordName)}<br><small style="color:#666;">Creado por: ${c.coordinador_usuario}</small></td>
                <td><span class="badge badge-red">Limbo</span></td>
                <td>
                    <button class="secondary-btn small-btn" style="background:#28a745; color:#fff;" onclick="asignarEstadoACirculo(${idx})">🩹 Asignar Estado</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = htmlString;
};

window.asignarEstadoACirculo = async function(idx) {
    const estado = prompt("¿A qué Estado pertenece este círculo?\n(Escríbelo exactamente igual, ej: Sinaloa, Baja California)");
    if (!estado) return;

    let circle = window.CRM.APP.circles[idx];
    
    const originalText = document.activeElement ? document.activeElement.textContent : "";
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
        document.activeElement.textContent = "⏳ Procesando...";
        document.activeElement.disabled = true;
    }

    try {
        if (window.fetchCircleFullDetails) {
            circle = await window.fetchCircleFullDetails(idx);
        }

        circle.acta.estado = window.toTitleCase(estado);
        
        await window.saveCircleToCloud(circle);
        alert(`✅ Círculo asignado a ${circle.acta.estado}. Actualizando lista...`);
        window.mostrarCirculosPerdidos();
        
        if (typeof window.updateStats === 'function') window.updateStats();
        
    } catch (e) {
        alert("Error al guardar: " + e.message);
    } finally {
        if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
            document.activeElement.textContent = originalText || "🩹 Asignar Estado";
            document.activeElement.disabled = false;
        }
    }
};

window.handleExportCirclePDF = async function(index) {
    const btn = document.activeElement;
    if(btn) { btn.textContent = "⏳ Cargando..."; btn.disabled = true; }

    try {
        let circle = window.CRM.APP.circles[index];
        if (window.fetchCircleFullDetails) {
            circle = await window.fetchCircleFullDetails(index);
        }
        if (typeof window.generateCirclePDF === 'function') {
            await window.generateCirclePDF(circle);
        } else {
            alert("Motor PDF no listo.");
        }
    } catch (e) {
        alert("Error al generar PDF: " + e.message);
    } finally {
        if(btn) { btn.textContent = "📄 PDF"; btn.disabled = false; }
    }
};

// ======================================================
// 9. PANEL DE AUDITORÍA Y VALIDACIÓN
// ======================================================

window.generarTarjetasContacto = function(cedulas, nombreCirculo) {
    if (!cedulas || cedulas.length === 0) return "<p>No hay integrantes registrados.</p>";
    
    let html = `<h4 style="color:#0d47a1; margin-top:15px; margin-bottom:10px;">👥 Contacto Rápido para Auditoría:</h4>`;
    html += `<div style="display:flex; flex-direction:column; gap:10px;">`;
    
    cedulas.forEach((m, i) => {
        const cleanPhone = (m.telefono || '').replace(/\D/g, '');
        const encodedMsg = encodeURIComponent(`Hola ${m.nombre.split(' ')[0]}, te escribo de la Mesa de Validación de Movimiento Ciudadano. Estamos auditando el círculo "${nombreCirculo}". ¿Tienes un minuto?`);
        
        html += `
            <div style="background: #fff; padding: 12px; border: 1px solid #ddd; border-radius: 6px; display:flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <div>
                    <strong style="font-size: 14px;">${i+1}. ${m.nombre}</strong> ${m.es_coordinador ? '<span style="background:#ff7e00; color:#fff; padding:2px 5px; border-radius:3px; font-size:10px;">Coord</span>' : ''}<br>
                    <span style="font-size: 13px; color: #555;">📞 ${m.telefono || 'Sin teléfono'}</span>
                </div>
                <div style="display:flex; gap:8px;">
                    ${cleanPhone.length >= 10 ? `
                        <a href="tel:${cleanPhone}" class="secondary-btn small-btn" style="background:#f8f9fa; color:#333; text-decoration:none; padding:6px 12px; border: 1px solid #ccc; margin:0;">📞 Llamar</a>
                        <a href="https://wa.me/52${cleanPhone}?text=${encodedMsg}" target="_blank" class="secondary-btn small-btn" style="background:#25D366; color:white; text-decoration:none; padding:6px 12px; border:none; margin:0;">💬 WhatsApp</a>
                    ` : `<span class="small" style="color:#dc3545;">Tel. Inválido</span>`}
                </div>
            </div>
        `;
    });
    
    html += `</div>`;
    return html;
};

window.abrirPanelValidacion = async function(index) {
    window.circuloEnRevisionId = index;
    const container = document.getElementById('validacion-info-area');
    container.innerHTML = '<p>⏳ Descargando evidencias del servidor...</p>';
    window.openModal('modalValidacion');

    document.getElementById('area-rechazo').style.display = 'none';
    document.querySelectorAll('.rechazo-cb').forEach(cb => cb.checked = false);
    if(document.getElementById('motivoRechazoExtra')) document.getElementById('motivoRechazoExtra').value = '';
    if(document.getElementById('motivoRechazo')) document.getElementById('motivoRechazo').value = '';

    try {
        let c = window.CRM.APP.circles[index];
        if (window.fetchCircleFullDetails) c = await window.fetchCircleFullDetails(index);

        let coordName = c.acta.coordinador || 'N/A';
        const designated = c.cedulas?.find(m => m.es_coordinador === true);
        if(designated) coordName = designated.nombre;

        let html = `<h3 style="color:#ff7e00; margin-top:0;">${c.acta.nombre}</h3><p style="margin-top:0;"><strong>Coordinador(a):</strong> ${coordName}</p>`;
        
        html += `<h4 style="color:#0d47a1; margin-bottom:10px;">📄 Evidencias Adjuntas (INE):</h4>`;
        if(c.cedulas) {
            c.cedulas.forEach((ced, i) => {
                const ineLink = ced.ine_frente || ced.ine_data; 
                html += `<div style="padding:10px; background:#fff; border:1px solid #eee; border-radius:6px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:14px;"><strong>${i+1}.</strong> ${ced.nombre}<br><small style="color:#666;">Clave: ${ced.clave_elector || 'N/A'}</small></span>
                    ${ineLink ? `<button onclick="window.open('${ineLink.startsWith('data') ? '' : ineLink}')" class="secondary-btn small-btn" style="margin:0;">👁️ Ver INE</button>` : '<span style="color:red; font-size:12px; font-weight:bold;">Sin INE</span>'}
                </div>`;
            });
        }

        html += window.generarTarjetasContacto(c.cedulas, c.acta.nombre);

        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<p style="color:red">Error cargando datos: ${e.message}</p>`;
    }
};

window.confirmarAprobacion = async function() {
    const c = window.CRM.APP.circles[window.circuloEnRevisionId];
    c.status = 'validado'; 
    c.validado_por = window.CRM.currentUser.usuario; 
    await window.saveCircleToCloud(c);
    alert("Aprobado ✅"); 
    window.closeModal('modalValidacion'); 
    window.applyCircleListFilters();
};

window.procesarRechazoAvanzado = async function() {
    const checkboxes = document.querySelectorAll('.rechazo-cb:checked');
    const notasExtra = document.getElementById('motivoRechazoExtra').value.trim();
    
    if (checkboxes.length === 0 && notasExtra === '') {
        return alert("⚠️ Debes seleccionar al menos una causa de la lista o escribir una nota.");
    }

    let dictamenFinal = "El círculo no superó la auditoría por las siguientes causas:\n";
    
    checkboxes.forEach((cb, index) => {
        dictamenFinal += `\n${index + 1}. ${cb.value}`;
    });

    if (notasExtra) {
        dictamenFinal += `\n\nNotas del auditor: ${notasExtra}`;
    }

    document.getElementById('motivoRechazo').value = dictamenFinal;
    window.guardarRechazo(); 
};

window.guardarRechazo = async function() {
    const c = window.CRM.APP.circles[window.circuloEnRevisionId];
    c.status = 'revision'; 
    c.feedback_validacion = document.getElementById('motivoRechazo').value;
    c.validado_por = window.CRM.currentUser.usuario; 
    
    await window.saveCircleToCloud(c);
    alert("Rechazado ❌ y notificado al coordinador."); 
    window.closeModal('modalValidacion'); 
    window.applyCircleListFilters();
};

window.mostrarAreaRechazo = () => document.getElementById('area-rechazo').style.display = 'block';
window.cerrarModalValidacion = () => window.closeModal('modalValidacion');

// ======================================================
// 10. GENERADOR DE CREDENCIALES (DIRECTORIO GLOBAL)
// ======================================================

window.showGlobalMemberList = function() {
    window.renderMemberListModal();
    window.openModal('modalMemberList');
};

window.renderMemberListModal = function() {
    const tbody = document.getElementById('memberListTbody');
    if (!tbody) return;
    
    const { circles } = window.getAccessibleData();
    const filterState = document.getElementById('memberStateFilter')?.value || '';
    const searchName = document.getElementById('memberSearchInput')?.value.toLowerCase() || '';
    const filterCoord = document.getElementById('memberFilterCoordinator')?.checked || false;
    
    const canDeleteGlobal = window.hasPermission('delete_items');

    let htmlString = "";
    let count = 0;
    let renderCount = 0;
    const MAX_RENDER = 300; 

    circles.forEach(c => {
        if (filterState && c.acta.estado !== filterState) return;
        const idx = window.CRM.APP.circles.indexOf(c);
        
        c.cedulas.forEach((m, mIdx) => {
            if (searchName && !m.nombre.toLowerCase().includes(searchName)) return;
            if (filterCoord && !m.es_coordinador) return;

            count++; 
            if (renderCount >= MAX_RENDER) return; 

            const isCoord = m.es_coordinador ? '<span style="color:#ff7e00; border:1px solid #ff7e00; font-size:10px; padding:0 2px;">COORD</span>' : '';
            const btnDeleteMember = canDeleteGlobal ? `<button class="secondary-btn small-btn" style="background:#dc3545; color:white; margin-top:5px; width:100%;" onclick="window.confirmDeleteMember(${idx}, ${mIdx})" title="Eliminar Integrante permanentemente">🗑️ Borrar Perfil</button>` : '';

            htmlString += `<tr>
                <td style="text-align:center;"><input type="checkbox" class="member-select" data-phone="${(m.telefono||'').replace(/\D/g,'')}"></td>
                <td><strong>${m.nombre}</strong> ${isCoord}</td>
                <td>${c.acta.nombre}</td>
                <td>${c.acta.estado}<br><small>${c.acta.municipio}</small></td>
                <td>${m.telefono}</td>
                <td style="min-width: 120px;">
                    <div style="display:flex; gap: 5px;">
                        <button class="secondary-btn small-btn" onclick="window.generateCredential(${idx}, ${mIdx})" title="Generar Credencial">🪪</button>
                        ${window.getWhatsappButton ? window.getWhatsappButton(m.telefono, m.nombre) : ''}
                        <button class="secondary-btn small-btn" onclick="window.openEditMemberModal(${idx}, ${mIdx})">✏️</button>
                    </div>
                    ${btnDeleteMember}
                </td>
            </tr>`;
            renderCount++;
        });
    });

    if (count > MAX_RENDER) {
        htmlString += `<tr><td colspan="6" style="text-align:center; background:#fff3cd; color:#856404; padding:15px; border-radius: 8px;"><b>⚠️ Mostrando ${MAX_RENDER} de ${count} integrantes. Escribe un nombre o filtra por Estado para encontrar a quien buscas.</b></td></tr>`;
    }

    tbody.innerHTML = htmlString;
    if(document.getElementById('memberVisibleCount')) document.getElementById('memberVisibleCount').textContent = count;
};

window.confirmDeleteMember = async function(cIdx, mIdx) {
    if(!window.hasPermission('delete_items')) return alert("⛔ Acceso denegado. Solo el Alto Mando puede eliminar integrantes.");
    
    const circle = window.CRM.APP.circles[cIdx];
    const member = circle.cedulas[mIdx];
    
    if(!confirm(`⚠️ ATENCIÓN: ¿Estás seguro de que deseas eliminar permanentemente a ${member.nombre} del círculo "${circle.acta.nombre}"?`)) return;
    
    try {
        circle.cedulas.splice(mIdx, 1);
        if (typeof window.saveCircleToCloud === 'function') {
            await window.saveCircleToCloud(circle);
        }
        alert("✅ Integrante eliminado del sistema.");
        window.renderMemberListModal(); 
        if(typeof window.updateStats === 'function') window.updateStats(); 
    } catch(e) {
        alert("Error al eliminar al integrante: " + e.message);
    }
};

window.filterGlobalMemberList = function() { window.renderMemberListModal(); };

window.generateCredential = async function(cIdx, mIdx) {
    const circle = window.CRM.APP.circles[cIdx];
    let member = circle.cedulas[mIdx];

    if (!member.foto_perfil && window.fetchCircleFullDetails) {
        try {
            const fullCircle = await window.fetchCircleFullDetails(cIdx);
            member = fullCircle.cedulas[mIdx];
        } catch(e) { console.warn("No se pudo bajar foto HD"); }
    }
    
    const hasPhoto = (member.foto_perfil && member.foto_perfil.length > 200);

    if (hasPhoto) {
        if (confirm(`📸 ${member.nombre} ya tiene foto.\n\n[Aceptar] Usar foto actual y generar PDF.\n[Cancelar] Abrir editor para CAMBIAR o BORRAR la foto.`)) {
            generatePDFInternal(member, circle);
        } else {
            window.openEditMemberModal(cIdx, mIdx);
        }
    } else {
        // iOS-safe: use custom modal with <label> trigger instead of input.click()
        const modal    = document.getElementById('modalCredPhoto');
        const fileInput = document.getElementById('credPhotoFileInput');
        const skipBtn  = document.getElementById('btnCredSkipPhoto');
        if (!modal || !fileInput || !skipBtn) { generatePDFInternal(member, circle); return; }

        fileInput.value = '';

        const onFileChange = async (e) => {
            cleanup();
            window.closeModal('modalCredPhoto');
            const file = e.target.files[0];
            if (file) {
                try {
                    const base64 = await window.fileToBase64(file);
                    member.foto_perfil = base64;
                    await window.saveCircleToCloud(circle);
                    generatePDFInternal(member, circle);
                } catch(err) {
                    alert('Error al subir foto: ' + err.message);
                }
            }
        };

        const onSkip = () => {
            cleanup();
            window.closeModal('modalCredPhoto');
            generatePDFInternal(member, circle);
        };

        const cleanup = () => {
            fileInput.removeEventListener('change', onFileChange);
            skipBtn.removeEventListener('click', onSkip);
        };

        fileInput.addEventListener('change', onFileChange);
        skipBtn.addEventListener('click', onSkip);
        window.openModal('modalCredPhoto');
    }
};

function generatePDFInternal(member, circle) {
    if(window.generateCredentialImage) {
        window.generateCredentialImage({
            nombre: member.nombre,
            rol: member.es_coordinador ? "COORDINADOR DE CÍRCULO" : "INTEGRANTE",
            estado: circle.acta.estado,
            municipio: circle.acta.municipio,
            circulo: circle.acta.nombre,
            curp: member.curp || '',
            id: `MIE-${Date.now().toString().slice(-6)}`,
            foto: member.foto_perfil
        });
    } else {
        alert("Motor de credenciales cargando...");
    }
}

window.toggleSelectAllMembers = function() {
    const master = document.getElementById('selectAllMembers');
    document.querySelectorAll('.member-select').forEach(cb => cb.checked = master.checked);
};

window.generateBulkWhatsappLinks = function() {
    const txt = document.getElementById('bulkMessageText').value;
    if(!txt) return alert("Escribe un mensaje.");
    
    const selected = document.querySelectorAll('.member-select:checked');
    if(selected.length === 0) return alert("Selecciona integrantes.");

    let generated = 0;
    selected.forEach(cb => {
        const phone = cb.dataset.phone;
        if(phone.length >= 10) {
            const tr = cb.closest('tr');
            const name = tr.cells[1].querySelector('strong').innerText.split(' ')[0];
            const msg = encodeURIComponent(`Hola ${name}, ${txt}`);
            const link = `https://wa.me/${phone}?text=${msg}`;
            tr.cells[tr.cells.length - 1].innerHTML = `<a href="${link}" target="_blank" class="whatsapp-btn" style="background:#ff7e00; color:white; padding:5px; text-decoration:none;">📤 ENVIAR</a>`;
            generated++;
        }
    });
    alert(`Listos ${generated} enlaces.`);
};

window.openEditMemberModal = function(cIdx, mIdx) {
    const m = window.CRM.APP.circles[cIdx].cedulas[mIdx];
    document.getElementById('edit_member_circle_idx').value = cIdx;
    document.getElementById('edit_member_idx').value = mIdx;
    document.getElementById('edit_member_name_input').value = m.nombre;
    document.getElementById('edit_member_preview').src = m.foto_perfil || 'img/default-avatar.png';
    
    const modalContent = document.querySelector('#modalEditMember .modal-content');
    if (!document.getElementById('btnDeletePhotoMember')) {
        const btnDel = document.createElement('button');
        btnDel.id = 'btnDeletePhotoMember';
        btnDel.className = 'secondary-btn small-btn';
        btnDel.style.cssText = 'background: #dc3545; color: white; margin-top: 10px; width: 100%;';
        btnDel.innerHTML = '🗑️ Borrar Foto Actual';
        btnDel.onclick = window.deleteMemberPhoto;
        
        const saveBtn = modalContent.querySelector('button.primary-btn');
        modalContent.insertBefore(btnDel, saveBtn);
    }
    
    const btnDel = document.getElementById('btnDeletePhotoMember');
    if (m.foto_perfil && m.foto_perfil.length > 200) {
        btnDel.style.display = 'block';
    } else {
        btnDel.style.display = 'none';
    }

    window.openModal('modalEditMember');
};

window.deleteMemberPhoto = async function() {
    if(!confirm("¿Seguro que deseas eliminar la foto de este integrante?")) return;
    
    const cIdx = document.getElementById('edit_member_circle_idx').value;
    const mIdx = document.getElementById('edit_member_idx').value;
    const circle = window.CRM.APP.circles[cIdx];
    
    circle.cedulas[mIdx].foto_perfil = null;
    
    document.getElementById('edit_member_preview').src = 'img/default-avatar.png';
    document.getElementById('btnDeletePhotoMember').style.display = 'none';
    
    alert("Foto eliminada. Pulsa 'Guardar Cambios' para confirmar en el servidor.");
};

window.saveMemberChanges = async function() {
    const cIdx = document.getElementById('edit_member_circle_idx').value;
    const mIdx = document.getElementById('edit_member_idx').value;
    const circle = window.CRM.APP.circles[cIdx];
    
    circle.cedulas[mIdx].nombre = document.getElementById('edit_member_name_input').value;
    
    const file = document.getElementById('edit_member_photo_input').files[0];
    if (file) {
        // Comprimir antes de guardar (igual que en el flujo de alta)
        const raw = await window.fileToBase64(file);
        circle.cedulas[mIdx].foto_perfil = (await window.compressToLimits(raw, window.IMG_LIMITS.profile)).b64;
    }
    
    await saveCircleToCloud(circle);
    window.closeModal('modalEditMember');
    alert("Cambios guardados exitosamente.");
    window.renderMemberListModal();
};

window.downloadAllCredentialsPDF = async function() {
    if(!confirm("⚠️ Esto generará un PDF masivo. ¿Continuar?")) return;

    const { circles } = window.getAccessibleData();
    let allMembers = [];
    circles.forEach(c => {
        c.cedulas.forEach(m => {
            allMembers.push({ ...m, circleName: c.acta.nombre, circleState: c.acta.estado, circleMun: c.acta.municipio });
        });
    });

    if(allMembers.length > 50) return alert("Son muchos registros (>50). Filtra por estado o municipio primero.");

    const doc = new window.jspdf.jsPDF();
    let x = 10, y = 10;
    alert("⏳ Generando credenciales...");

    for (let i = 0; i < allMembers.length; i++) {
        const m = allMembers[i];
        document.getElementById('cred-name').textContent = m.nombre.toUpperCase();
        const bulkRolEl = document.getElementById('cred-role');
        const bulkBanner = document.getElementById('cred-coordinador-banner');
        if (m.es_coordinador) {
            bulkRolEl.textContent = "COORDINADOR DE CÍRCULO";
            bulkRolEl.style.color = '#ff7e00'; bulkRolEl.style.fontWeight = 'bold';
            if (bulkBanner) bulkBanner.style.display = 'block';
        } else {
            bulkRolEl.textContent = "INTEGRANTE";
            bulkRolEl.style.color = ''; bulkRolEl.style.fontWeight = '';
            if (bulkBanner) bulkBanner.style.display = 'none';
        }
        document.getElementById('cred-state').textContent = m.circleState.toUpperCase();
        document.getElementById('cred-mun').textContent = m.circleMun.toUpperCase();
        document.getElementById('cred-circle').textContent = m.circleName.toUpperCase();
        document.getElementById('cred-photo').src = m.foto_perfil || "img/default-avatar.png";
        
        document.getElementById('cred-qr').innerHTML = '';
        new QRCode(document.getElementById('cred-qr'), { text: m.nombre, width: 70, height: 70 });

        await new Promise(r => setTimeout(r, 150));
        
        try {
            const canvas = await html2canvas(document.getElementById('credential-card'), { scale: 1.5, useCORS: true, logging: false });
            const imgData = canvas.toDataURL('image/jpeg', 0.8);

            if (x > 110) { x = 10; y += 95; } 
            if (y > 200) { doc.addPage(); x = 10; y = 10; } 
            doc.addImage(imgData, 'JPEG', x, y, 85, 54); 
            x += 95;
        } catch (e) { console.warn("Error en credencial " + i, e); }
    }
    doc.save("Credenciales_Lote.pdf");
    alert("✅ PDF Generado.");
};

// ======================================================
// 11. BITÁCORA DE SESIONES (Art. 15 — Reglamento CC)
// ======================================================

let _sesCircleIdx = null;

window.abrirBitacora = function(idx) {
    _sesCircleIdx = idx;
    const circle = window.CRM.APP.circles[idx];
    if (!circle) return;

    const subtitle = circle.acta.nombre + ' — ' + (circle.acta.municipio || '') + ', ' + (circle.acta.estado || '');
    document.getElementById('sesiones-circle-subtitle').textContent = subtitle;

    // Fecha por defecto: hoy
    const _nowSes = new Date();
    const _localSes = `${_nowSes.getFullYear()}-${String(_nowSes.getMonth()+1).padStart(2,'0')}-${String(_nowSes.getDate()).padStart(2,'0')}`;
    document.getElementById('ses_fecha').value = _localSes;
    document.getElementById('ses_hora').value  = '18:00';
    document.getElementById('ses_acuerdos').value = '';
    document.getElementById('ses_notas').value    = '';
    document.getElementById('ses_lugar').value    = '';
    document.getElementById('ses_tipo').value     = 'ordinaria';

    // Construir checkboxes de asistentes desde los integrantes
    const checksDiv = document.getElementById('ses_asistentes_checks');
    checksDiv.innerHTML = '';
    (circle.cedulas || []).forEach(m => {
        const lbl = document.createElement('label');
        lbl.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:#e3f2fd;padding:5px 10px;border-radius:14px;font-size:12px;cursor:pointer;border:1px solid #90caf9;';
        const parts = m.nombre.split(' ');
        const shortName = (parts[0] || '') + (parts[1] ? ' ' + parts[1] : '');
        lbl.innerHTML = `<input type="checkbox" class="ses-asistente-cb" value="${m.nombre}" checked style="width:auto;margin:0;"> ${shortName}`;
        lbl.title = m.nombre;
        checksDiv.appendChild(lbl);
    });

    // Agregar opción "Invitado externo"
    const addExt = document.createElement('button');
    addExt.type = 'button';
    addExt.textContent = '+ Externo';
    addExt.style.cssText = 'font-size:11px;background:none;border:1px dashed #aaa;border-radius:10px;padding:4px 8px;cursor:pointer;color:#666;';
    addExt.onclick = () => {
        const nombre = prompt('Nombre del invitado externo:');
        if (!nombre) return;
        const lbl = document.createElement('label');
        lbl.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:#fff3e0;padding:5px 10px;border-radius:14px;font-size:12px;cursor:pointer;border:1px solid #ffcc80;';
        lbl.innerHTML = `<input type="checkbox" class="ses-asistente-cb" value="${nombre} (Invitado)" checked style="width:auto;margin:0;"> ${nombre} <small style="color:#f57c00;">(ext)</small>`;
        checksDiv.insertBefore(lbl, addExt);
    };
    checksDiv.appendChild(addExt);

    window.renderSesiones(idx);
    window.openModal('modalSesiones');
};

window.renderSesiones = function(idx) {
    const circle = window.CRM.APP.circles[idx];
    if (!circle) return;

    const listDiv = document.getElementById('sesiones-list');
    const sesiones = (circle.sesiones || []);

    if (sesiones.length === 0) {
        listDiv.innerHTML = `
            <div style="text-align:center;padding:30px;color:#aaa;border:2px dashed #ddd;border-radius:8px;margin-top:10px;">
                <div style="font-size:42px;margin-bottom:8px;">📋</div>
                <p style="margin:0;font-weight:bold;color:#777;">Sin sesiones registradas</p>
                <p class="small" style="margin:6px 0 0;color:#aaa;">Registra la primera sesión del Círculo usando el formulario de arriba.</p>
            </div>`;
        return;
    }

    // Ordenar de más reciente a más antigua
    const sorted = [...sesiones].map((s, i) => ({ ...s, _origIdx: i }))
                                .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    const tipoBadges = {
        ordinaria:    '<span style="background:#1565c0;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">📅 Ordinaria</span>',
        extraordinaria: '<span style="background:#e53935;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">⚡ Extraordinaria</span>'
    };

    let html = `<h4 style="color:#0d47a1;margin:0 0 12px;border-bottom:2px solid #e3f2fd;padding-bottom:6px;">
        📅 Historial — ${sesiones.length} Sesión${sesiones.length !== 1 ? 'es' : ''} registrada${sesiones.length !== 1 ? 's' : ''}
    </h4>`;

    sorted.forEach(ses => {
        const realIdx = ses._origIdx;
        let fechaStr = ses.fecha;
        try {
            fechaStr = new Date(ses.fecha + 'T12:00:00').toLocaleDateString('es-MX',
                { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            fechaStr = fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1);
        } catch(e) {}

        const badge = tipoBadges[ses.tipo] || tipoBadges.ordinaria;
        const asistentes = ses.asistentes || [];
        const quorum = circle.cedulas?.length
            ? Math.round((asistentes.filter(a => !a.includes('(Invitado)')).length / circle.cedulas.length) * 100)
            : 0;
        const quorumColor = quorum >= 50 ? '#2e7d32' : '#e65100';

        html += `
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;margin-bottom:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <div style="background:#f5f5f5;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;border-bottom:1px solid #eee;">
            <div>
              <strong style="font-size:14px;">${fechaStr}</strong>${ses.hora ? ' · <span style="color:#666;">' + ses.hora + ' h</span>' : ''}<br>
              <small style="color:#888;">📍 ${ses.lugar || 'Lugar no especificado'}</small>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              ${badge}
              <button onclick="window.eliminarSesion(${idx}, ${realIdx})"
                style="background:none;border:none;cursor:pointer;color:#dc3545;font-size:16px;padding:2px 6px;border-radius:4px;"
                title="Eliminar sesión">🗑️</button>
            </div>
          </div>
          <div style="padding:12px 14px;">
            <div style="margin-bottom:10px;">
              <span style="font-size:12px;color:#888;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;">
                👥 Asistentes (${asistentes.length}
                ${circle.cedulas?.length ? '/ ' + circle.cedulas.length + ' — <span style="color:' + quorumColor + ';font-weight:bold;">' + quorum + '% quórum</span>' : ''})
              </span>
              <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">
                ${asistentes.map(a => {
                    const isExt = a.includes('(Invitado)');
                    return `<span style="background:${isExt ? '#fff3e0' : '#e3f2fd'};border:1px solid ${isExt ? '#ffcc80' : '#90caf9'};padding:2px 8px;border-radius:10px;font-size:11px;">${a}</span>`;
                }).join('')}
                ${asistentes.length === 0 ? '<span style="color:#aaa;font-size:12px;font-style:italic;">Sin asistentes registrados</span>' : ''}
              </div>
            </div>
            ${ses.acuerdos ? `
            <div style="margin-bottom:8px;">
              <span style="font-size:12px;color:#888;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;">📝 Acuerdos</span>
              <div style="margin-top:5px;background:#fffde7;padding:10px 12px;border-radius:6px;border-left:4px solid #f9a825;font-size:13px;line-height:1.5;">
                ${ses.acuerdos.replace(/\n/g, '<br>')}
              </div>
            </div>` : ''}
            ${ses.notas ? `
            <div style="margin-bottom:6px;">
              <span style="font-size:12px;color:#888;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;">📎 Notas</span>
              <p style="margin:5px 0 0;font-size:12px;color:#555;font-style:italic;">${ses.notas.replace(/\n/g, '<br>')}</p>
            </div>` : ''}
            <div style="margin-top:8px;text-align:right;border-top:1px solid #f5f5f5;padding-top:6px;">
              <small style="color:#bbb;font-size:11px;">Registrada por: <strong>${ses.registrada_por || '—'}</strong></small>
            </div>
          </div>
        </div>`;
    });

    listDiv.innerHTML = html;
};

window.guardarSesion = async function() {
    const idx = _sesCircleIdx;
    if (idx === null || idx === undefined) return;

    const circle = window.CRM.APP.circles[idx];
    if (!circle) return;

    const fecha = document.getElementById('ses_fecha').value;
    if (!fecha) return alert('⚠️ Selecciona la fecha de la sesión.');

    const acuerdos = document.getElementById('ses_acuerdos').value.trim();
    if (!acuerdos) return alert('⚠️ Los acuerdos de la sesión son obligatorios.');

    const asistentes = [...document.querySelectorAll('.ses-asistente-cb:checked')].map(cb => cb.value);

    const nuevaSesion = {
        id:             'ses_' + Date.now(),
        fecha:          fecha,
        hora:           document.getElementById('ses_hora').value,
        tipo:           document.getElementById('ses_tipo').value,
        lugar:          document.getElementById('ses_lugar').value.trim(),
        asistentes:     asistentes,
        acuerdos:       acuerdos,
        notas:          document.getElementById('ses_notas').value.trim(),
        registrada_por: window.CRM.currentUser?.usuario || '—',
        fecha_registro: new Date().toISOString()
    };

    if (!circle.sesiones) circle.sesiones = [];
    circle.sesiones.push(nuevaSesion);

    // Limpiar formulario y cerrar el details
    document.getElementById('ses_acuerdos').value = '';
    document.getElementById('ses_notas').value    = '';
    document.getElementById('ses_lugar').value    = '';
    const det = document.getElementById('nueva-sesion-details');
    if (det) det.removeAttribute('open');

    window.renderSesiones(idx);

    try {
        await window.saveCircleToCloud(circle);
        alert('✅ Sesión registrada y guardada correctamente.');
    } catch(e) {
        alert('⚠️ Sesión guardada localmente. Se sincronizará automáticamente cuando haya conexión.');
    }
};

window.eliminarSesion = async function(idx, sesIdx) {
    if (!confirm('¿Eliminar esta sesión del historial? Esta acción no se puede deshacer.')) return;
    const circle = window.CRM.APP.circles[idx];
    if (!circle || !circle.sesiones) return;
    circle.sesiones.splice(sesIdx, 1);
    window.renderSesiones(idx);
    try { await window.saveCircleToCloud(circle); } catch(e) {}
};

// ======================================================
// 12. OBSERVATORIO CIUDADANO (Art. 17 — Reglamento CC)
// ======================================================

window.abrirObservatorio = function() {
    const sel = document.getElementById('obs_filtro_estado');
    if (!sel) return;

    sel.innerHTML = '<option value="">— Todos los Estados —</option>';
    const estados = [...new Set(
        (window.CRM.APP.circles || []).map(c => c.acta?.estado).filter(Boolean)
    )].sort();
    estados.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e; opt.textContent = e;
        sel.appendChild(opt);
    });

    // Pre-seleccionar estado del usuario si no es nivel nacional
    const rol = window.CRM.currentUser?.rol || '';
    const esNacional = window.hasPermission('view_all_users') || rol === 'validacion' || rol.startsWith('titular_nacional');
    if (!esNacional && window.CRM.currentUser?.estado) {
        sel.value = window.CRM.currentUser.estado;
    }
    document.getElementById('obs_filtro_municipio').value = '';

    window.renderObservatorio();
    window.openModal('modalObservatorio');
};

window.renderObservatorio = function() {
    const filtroEstado = document.getElementById('obs_filtro_estado')?.value  || '';
    const filtroMun    = (document.getElementById('obs_filtro_municipio')?.value || '').toLowerCase().trim();

    const allCircles = window.getAccessibleData
        ? window.getAccessibleData().circles
        : (window.CRM.APP.circles || []);

    // Agrupar por estado+municipio
    const porMunicipio = {};
    allCircles.forEach(c => {
        const estado = c.acta?.estado || 'Sin Estado';
        const mun    = c.acta?.municipio || 'Sin Municipio';
        if (filtroEstado && estado !== filtroEstado) return;
        if (filtroMun    && !mun.toLowerCase().includes(filtroMun)) return;

        const key = estado + '||' + mun;
        if (!porMunicipio[key]) porMunicipio[key] = { estado, mun, circles: [] };
        porMunicipio[key].circles.push(c);
    });

    const keys = Object.keys(porMunicipio).sort();
    const container = document.getElementById('observatorio-content');
    if (!container) return;

    if (keys.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#aaa;"><div style="font-size:40px;">🔭</div><p>No hay Círculos que coincidan con el filtro.</p></div>';
        return;
    }

    // Resumen global
    const totalCirculos   = keys.reduce((s, k) => s + porMunicipio[k].circles.length, 0);
    const totalIntegrantes = keys.reduce((s, k) =>
        s + porMunicipio[k].circles.reduce((ss, c) => ss + (c.cedulas?.length || 0), 0), 0);
    const totalSesiones   = keys.reduce((s, k) =>
        s + porMunicipio[k].circles.reduce((ss, c) => ss + (c.sesiones?.length || 0), 0), 0);

    let html = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
      <div style="background:#e8f5e9;border-radius:8px;padding:12px;text-align:center;border:1px solid #c8e6c9;">
        <div style="font-size:22px;font-weight:bold;color:#2e7d32;">${keys.length}</div>
        <div style="font-size:11px;color:#555;">Municipios</div>
      </div>
      <div style="background:#e3f2fd;border-radius:8px;padding:12px;text-align:center;border:1px solid #90caf9;">
        <div style="font-size:22px;font-weight:bold;color:#1565c0;">${totalCirculos}</div>
        <div style="font-size:11px;color:#555;">Círculos</div>
      </div>
      <div style="background:#fff3e0;border-radius:8px;padding:12px;text-align:center;border:1px solid #ffcc80;">
        <div style="font-size:22px;font-weight:bold;color:#e65100;">${totalIntegrantes}</div>
        <div style="font-size:11px;color:#555;">Integrantes</div>
      </div>
    </div>`;

    keys.forEach(key => {
        const { estado, mun, circles: mCircles } = porMunicipio[key];
        const totalInt  = mCircles.reduce((s, c) => s + (c.cedulas?.length || 0), 0);
        const totalSes  = mCircles.reduce((s, c) => s + (c.sesiones?.length || 0), 0);

        // Construir enlaces WA para convocar
        const waLinks = [];

        html += `
        <div style="background:#fff;border:1px solid #c8e6c9;border-radius:10px;margin-bottom:18px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.07);">
          <div style="background:#2e7d32;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <div>
              <strong style="font-size:15px;">🏛️ ${mun}</strong>
              <span style="opacity:0.8;font-size:12px;margin-left:8px;">· ${estado}</span>
            </div>
            <div style="font-size:12px;opacity:0.9;display:flex;gap:14px;">
              <span>⭕ ${mCircles.length} Círculo${mCircles.length>1?'s':''}</span>
              <span>👥 ${totalInt} Integrante${totalInt!==1?'s':''}</span>
              <span>📋 ${totalSes} Sesión${totalSes!==1?'es':''}</span>
            </div>
          </div>
          <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f1f8e9;">
                <th style="padding:8px 12px;text-align:left;color:#2e7d32;font-weight:bold;">Círculo Ciudadano</th>
                <th style="padding:8px 12px;text-align:left;color:#2e7d32;">Coordinador(a)</th>
                <th style="padding:8px 12px;text-align:center;color:#2e7d32;">Integr.</th>
                <th style="padding:8px 12px;text-align:center;color:#2e7d32;">Sesiones</th>
                <th style="padding:8px 12px;text-align:center;color:#2e7d32;">Últ. Sesión</th>
                <th style="padding:8px 12px;text-align:center;color:#2e7d32;">Contacto</th>
              </tr>
            </thead>
            <tbody>`;

        mCircles.forEach(c => {
            const coord       = c.cedulas?.find(m => m.es_coordinador);
            const coordNombre = coord
                ? (window.toTitleCase ? window.toTitleCase(coord.nombre) : coord.nombre)
                : '<span style="color:#e65100;font-style:italic;">Sin designar</span>';
            const coordTel    = coord?.telefono?.replace(/\D/g,'') || '';
            const intCount    = c.cedulas?.length || 0;
            const sesList     = c.sesiones || [];
            const sesCount    = sesList.length;

            // Última sesión
            let ultimaSes = '—';
            if (sesCount > 0) {
                const lastFecha = sesList.map(s => s.fecha).sort().pop();
                try {
                    ultimaSes = new Date(lastFecha + 'T12:00:00').toLocaleDateString('es-MX',
                        { day: '2-digit', month: 'short', year: 'numeric' });
                } catch(e) { ultimaSes = lastFecha; }
            }

            // WA link coordinador
            let waCell = '<span style="color:#ccc;font-size:11px;">Sin tel.</span>';
            if (coordTel.length >= 10) {
                const msg = encodeURIComponent(`Hola ${coord.nombre.split(' ')[0]}, te convoco a la sesión mensual del Observatorio Ciudadano de ${mun}, ${estado}. Por favor confirma tu asistencia.`);
                waCell = `<a href="https://wa.me/52${coordTel}?text=${msg}" target="_blank" style="background:#25D366;color:#fff;padding:3px 8px;border-radius:4px;text-decoration:none;font-size:11px;font-weight:bold;">📱 WA</a>`;
                waLinks.push({ nombre: coord.nombre.split(' ')[0], tel: coordTel, circulo: c.acta.nombre });
            }

            // Semáforo de sesiones (¿se reúnen regularmente?)
            const sesSemaforo = sesCount === 0
                ? '<span title="Sin sesiones registradas" style="color:#dc3545;">🔴</span>'
                : sesCount < 3
                    ? '<span title="Pocas sesiones" style="color:#f9a825;">🟡</span>'
                    : '<span title="Activo" style="color:#2e7d32;">🟢</span>';

            html += `<tr style="border-bottom:1px solid #f0f0f0;transition:background .2s;" onmouseover="this.style.background='#f9fbe7'" onmouseout="this.style.background=''">
              <td style="padding:9px 12px;"><strong>${c.acta.nombre}</strong></td>
              <td style="padding:9px 12px;">${coordNombre}</td>
              <td style="padding:9px 12px;text-align:center;font-weight:bold;">${intCount}</td>
              <td style="padding:9px 12px;text-align:center;">${sesCount} ${sesSemaforo}</td>
              <td style="padding:9px 12px;text-align:center;font-size:12px;color:#666;">${ultimaSes}</td>
              <td style="padding:9px 12px;text-align:center;">${waCell}</td>
            </tr>`;
        });

        html += `</tbody></table></div>`;

        // Botón "Convocar Observatorio" si hay coordinadores con tel
        if (waLinks.length > 0) {
            const waConvocatoria = waLinks.map(w => {
                const msg = encodeURIComponent(`Hola ${w.nombre}, te convoco a la sesión mensual del Observatorio Ciudadano de ${mun}, ${estado}. Por favor confirma tu asistencia.`);
                return `<a href="https://wa.me/52${w.tel}?text=${msg}" target="_blank" style="font-size:11px;background:#25D366;color:#fff;padding:2px 8px;border-radius:10px;text-decoration:none;">${w.nombre}</a>`;
            }).join(' ');

            html += `
          <div style="padding:10px 14px;background:#f1f8e9;border-top:1px solid #c8e6c9;">
            <span style="font-size:12px;color:#2e7d32;font-weight:bold;">📢 Convocar a:</span>
            <span style="margin-left:8px;">${waConvocatoria}</span>
          </div>`;
        }

        html += `</div>`;
    });

    container.innerHTML = html;
};
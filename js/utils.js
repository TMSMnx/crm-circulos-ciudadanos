/**
 * utils.js
 * Funciones de utilidad, manejo de archivos, UI b��sica y persistencia.
 * Versi��n: 6.0 (Final - SafeStorage, GPS Robusto, Password Toggle)
 */

// ======================================================
// 1. MANEJO SEGURO DE ALMACENAMIENTO (Evita Crash por Bloqueo)
// ======================================================
window.safeStorage = {
    getItem: function(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            console.warn("Almacenamiento bloqueado (Modo Inc��gnito).");
            return null; 
        }
    },
    setItem: function(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            console.warn("No se pudo guardar en local:", e);
        }
    },
    removeItem: function(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {}
    }
};

// ======================================================
// 2. UTILIDADES DE FORMATO Y TEXTO
// ======================================================

window.limpiarTelefono = function(tel) {
    if (!tel) return '';
    return tel.replace(/\D/g, '');
};

window.getWhatsappButton = function(whatsapp, name) {
    if (!whatsapp || whatsapp.length < 10) return '<span style="color:#ccc; font-size:11px;">Sin WA</span>';
    
    const cleanPhone = window.limpiarTelefono(whatsapp);
    const msg = encodeURIComponent(`Hola ${name}, te contacto desde el CRM.`);
    
    // --- �9�7 FIX CODIFICACI�0�7N: Usamos \uD83D\uDCF1 en vez del emoji directo ---
    return `<a href="https://wa.me/${cleanPhone}?text=${msg}" target="_blank" class="whatsapp-btn" style="background:#25D366; color:white; padding:4px 8px; border-radius:4px; text-decoration:none; font-size:12px; font-weight:bold;">\uD83D\uDCF1 WhatsApp</a>`;
};

// ======================================================
// 3. ARCHIVOS E IM�0�9GENES
// ======================================================

window.isCanvasEmpty = function(canvas) {
    if (!canvas) return true;
    const context = canvas.getContext('2d');
    const pixelBuffer = new Uint32Array(
        context.getImageData(0, 0, canvas.width, canvas.height).data.buffer
    );
    return !pixelBuffer.some(pixel => pixel !== 0);
};

window.fileToBase64 = function(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
};

// Delega a compressToLimits (ocr-engine.js) usando los límites estándar de perfil.
// Retorna solo el base64 para compatibilidad con los llamadores existentes.
window.compressImage = async function(file) {
    const limits = window.IMG_LIMITS?.profile || { maxW: 400, maxH: 400, quality: 0.60, maxKB: 80 };
    const { b64 } = await window.compressToLimits(file, limits);
    return b64;
};

// ======================================================
// 4. GEOLOCALIZACI�0�7N (GPS ROBUSTO)
// ======================================================

window.getCurrentLocation = function(latId, lngId) {
    // 1. Verificar soporte
    if (!navigator.geolocation) {
        return alert("�7�4 Tu navegador no tiene soporte para GPS.");
    }
    
    // 2. Feedback visual inmediato
    const latInput = document.getElementById(latId);
    const lngInput = document.getElementById(lngId);
    
    if(latInput) latInput.value = "Buscando...";
    if(lngInput) lngInput.value = "Conectando...";
    
    // 3. Configuraci��n de alta precisi��n
    const options = {
        enableHighAccuracy: true, // Forzar GPS real
        timeout: 10000,           // Esperar m��ximo 10 segundos
        maximumAge: 0             // No usar cach�� vieja
    };

    // 4. �0�7xito
    const success = (pos) => {
        const crd = pos.coords;
        if(latInput) latInput.value = crd.latitude.toFixed(7);
        if(lngInput) lngInput.value = crd.longitude.toFixed(7);
    };

    // 5. Error (Diagn��stico)
    const error = (err) => {
        console.warn(`ERROR GPS(${err.code}): ${err.message}`);
        
        let msg = "No se pudo obtener la ubicaci��n.";
        
        if (err.code === 1) { // PERMISSION_DENIED
            msg = "�7�4 ACCESO DENEGADO: Debes permitir la ubicaci��n en tu navegador (Icono �9�8 o �9�9 arriba).";
        } else if (err.code === 2) { // POSITION_UNAVAILABLE
            msg = "�7�4 SIN SE�0�5AL: Verifica que tu GPS/Ubicaci��n est�� activado en el dispositivo.";
        } else if (err.code === 3) { // TIMEOUT
            msg = "�7�4 TIEMPO AGOTADO: El GPS tard�� demasiado. Intenta de nuevo.";
        }
        
        // Verificar HTTPS
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
            msg += "\n\n�7�2�1�5 IMPORTANTE: El GPS requiere que el sitio use HTTPS (Candado de seguridad).";
        }

        alert(msg);
        if(latInput) latInput.value = "";
        if(lngInput) lngInput.value = "";
    };

    // 6. Ejecutar
    navigator.geolocation.getCurrentPosition(success, error, options);
};

// ======================================================
// 5. MODALES Y UI
// ======================================================

window.openModal = function(id) {
    const modal = document.getElementById(id);
    if(modal) modal.style.display = 'flex';
    
    // --- FIX ANTI-CONGELAMIENTO (setTimeout) ---
    setTimeout(() => {
        // L��gica espec��fica al abrir
        if (id === 'modalCedula' || id === 'modalActa' || id === 'modalCreateUser') {
            if(typeof window.checkAndSetStateLock === 'function') window.checkAndSetStateLock();
        }
        // Llenar select de roles
        if (id === 'modalCreateUser') {
            if(typeof window.populateRolesSelect === 'function') window.populateRolesSelect();
        }
        // Llenar filtros de eventos
        if (id === 'modalSelectInvites') {
            if(typeof window.handleSelectInvitesModal === 'function') window.handleSelectInvitesModal();
        }
    }, 50); // 50ms de respiro para el navegador
};

window.closeModal = function(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';

    if (id === 'modalCedula') {
        if (typeof window.resetCedulaForm === 'function') window.resetCedulaForm();
    }
    
    if (id === 'modalCreateUser') {
        if(window.CRM) window.CRM.editingUser = null;
        const form = document.getElementById('formCreateUser');
        if (form) form.reset();

        const usuarioInput = document.getElementById('u_usuario');
        if (usuarioInput) usuarioInput.removeAttribute('readonly');

        const h3 = document.querySelector('#modalCreateUser h3');
        if (h3) h3.textContent = '�9�4 Crear Nuevo Coordinador';

        const button = document.querySelector('#formCreateUser button[type="submit"]');
        if (button) button.textContent = 'Crear Coordinador';

        document.getElementById('u_estado')?.removeAttribute('disabled');
        document.getElementById('u_municipio')?.removeAttribute('disabled');
        
        // Resetear campo password visualmente
        const passInput = document.getElementById('u_password');
        if (passInput) { passInput.type = "password"; passInput.placeholder = ""; }
        const eyeIcon = document.querySelector('#formCreateUser .toggle-eye');
        if (eyeIcon) eyeIcon.textContent = "👁️";
        // Ocultar panel de contraseña temporal
        const tempDisp = document.getElementById('password-temp-display');
        if (tempDisp) tempDisp.style.display = 'none';

        if (typeof window.resetConditionalFields === 'function') window.resetConditionalFields();
    }
};

/**
 * checkAndSetStateLock
 * Bloquea el campo de estado para usuarios locales.
 */
window.checkAndSetStateLock = function() {
    if (!window.CRM || !window.CRM.currentUser) return;

    const rol = window.CRM.currentUser.rol;
    const myState = window.CRM.currentUser.estado;

    // Si es Admin Nacional o Titular Nacional, NO BLOQUEAR
    const isNationalLevel = rol === 'secretario_nacional' || rol === 'admin' || rol === 'validacion' || rol.startsWith('titular_nacional_');

    const stateSelects = ['acta_estado', 'u_estado'];
    const municipalInputs = ['acta_municipio', 'u_municipio'];

    if (isNationalLevel) {
        stateSelects.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.disabled = false;
                if(id === 'u_estado' && (!window.CRM.editingUser)) {
                    // No forzamos limpieza para evitar conflictos visuales
                } 
            }
        });
        return; 
    }

    // Si es Nivel Estatal
    if (rol === 'secretario_estatal' || rol.includes('delegado_estatal') || rol === 'coordinador_estatal_usa') {
        stateSelects.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                select.value = myState;
                select.disabled = true;
            }
        });
    }

    // Si es Nivel Municipal
    if (rol === 'secretario_municipal' || rol.includes('delegado_municipal') || rol.includes('regidor') || rol.includes('sindico')) {
        stateSelects.forEach(id => {
            const select = document.getElementById(id);
            if (select) {
                select.value = myState;
                select.disabled = true;
            }
        });
        municipalInputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.value = window.CRM.currentUser.municipio || "";
                input.disabled = true; 
            }
        });
    }
};

// ======================================================
// 6. TOGGLE PASSWORD (OJITO)
// ======================================================
window.togglePassword = function(inputId, iconElement) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    if (input.type === "password") {
        input.type = "text";
        iconElement.textContent = "�0�8"; // Cambiar icono a "ocultar"
    } else {
        input.type = "password";
        iconElement.textContent = "�9�9�1�5"; // Cambiar icono a "ver"
    }
};

window.setupPasswordToggle = function() {
    // Inicializador si se requiere en el futuro
};
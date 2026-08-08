/**
 * api-service.js
 * Capa de comunicación con el Backend (api.php).
 * Versión: 12.0 (Sesión segura, manejo de 401, ping por sesión)
 */

window.API_URL = 'api.php';
window.CRM = window.CRM || {};
window.CRM.serverStatus = 'green';
window.isSyncing = false;

// ====================================================================
// UTILIDAD INTERNA: fetch con credentials y manejo de 401
// ====================================================================

async function apiFetch(url, options = {}) {
    const defaults = { credentials: 'same-origin' };
    const merged   = { ...defaults, ...options };

    const response = await fetch(url, merged);

    if (response.status === 401) {
        // Sesión expirada: limpiar y redirigir al login
        localStorage.removeItem('crm_user');
        window.CRM.currentUser = null;
        window.location.reload();
        throw new Error('Sesión expirada.');
    }

    return response;
}

// ====================================================================
// 1. CARGA INICIAL
// ====================================================================

window.loadDataFromCloud = async function() {
    console.log('📡 Conectando con el servidor...');
    crearSemaforoUI();

    const indicator = document.getElementById('db-loading-indicator');
    if (indicator) {
        indicator.style.display = 'block';
        indicator.textContent   = 'Sincronizando Mando Central...';
    }

    try {
        const resInit = await apiFetch(`${window.API_URL}?action=load_initial_data&t=${Date.now()}`);
        if (!resInit.ok) throw new Error(`Error HTTP: ${resInit.status}`);

        const dataInit = await resInit.json();

        if (dataInit.status === 'success') {
            window.CRM.APP.users        = dataInit.users        || [];
            window.CRM.APP.customRoles  = dataInit.customRoles  || [];
            window.CRM.APP.trafficRules = dataInit.trafficRules || [];
            window.CRM.APP.areas        = dataInit.areas        || [];

            const verEl = document.getElementById('app-version');
            if (verEl) verEl.textContent = window.CRM?.APP_VERSION || '15.9';

            iniciarHeartbeat();
            setInterval(window.processSyncQueue, 15000);
        } else {
            throw new Error('Respuesta del servidor inválida');
        }

        if (indicator) indicator.textContent = 'Descargando Actas...';
        await window.loadCirclesLite();

    } catch (error) {
        console.error('❌ Error crítico de conexión:', error);
        if (indicator) indicator.textContent = '⚠️ Sin conexión o servidor saturado';
        actualizarSemaforo('red');
        window.loadLocalBackup();
    } finally {
        if (indicator) setTimeout(() => indicator.style.display = 'none', 1500);
    }
};

window.loadCirclesLite = async function() {
    try {
        const res = await apiFetch(`${window.API_URL}?action=load_circles_lite&t=${Date.now()}`);
        if (!res.ok) throw new Error(`Error Servidor al bajar círculos: ${res.status}`);

        const rawText = await res.text();
        let data;

        try {
            data = JSON.parse(rawText);
        } catch (parseError) {
            console.error('🔥 Error crítico: El JSON llegó roto.');
            alert('⚠️ ALERTA DE SISTEMA: Servidor bajo alta demanda. Trabajando en Modo Caché Parcial.');
            const partialJson = rawText + ']}';
            try { data = JSON.parse(partialJson); } catch (e) { throw new Error('Insalvable.'); }
        }

        if (data.circles) {
            window.CRM.APP.circles = data.circles;
            const totalEl = document.getElementById('totalCircles');
            if (totalEl) totalEl.textContent = data.circles.length;
            if (window.updateStats) window.updateStats();
            localStorage.setItem('crm_backup_circles', JSON.stringify(data.circles));
        }
        if (data.events) window.CRM.APP.events = data.events;

        actualizarSemaforo('green');
    } catch (e) {
        actualizarSemaforo('red');
        window.loadLocalBackup();
    }
};

// ====================================================================
// 2. LAZY LOADING
// ====================================================================

window.fetchCircleFullDetails = async function(indexOrId) {
    let circle = null;
    let index  = -1;

    if (typeof indexOrId === 'number') {
        index  = indexOrId;
        circle = window.CRM.APP.circles[index];
    } else {
        circle = window.CRM.APP.circles.find(c => c._db_uid === indexOrId || c.unique_id === indexOrId);
        index  = window.CRM.APP.circles.indexOf(circle);
    }

    if (!circle) throw new Error('Círculo no encontrado en memoria');

    const hasPhotos = circle.cedulas?.some(c =>
        (c.ine_data?.length > 20) || (c.foto_perfil?.length > 20)
    );
    if (circle._isFullDetails || hasPhotos || circle._isOffline) return circle;

    const uid = circle._db_uid || circle.unique_id;
    if (!uid) return circle;

    try {
        const res = await apiFetch(`${window.API_URL}?action=get_circle_details&uid=${encodeURIComponent(uid)}`);
        if (!res.ok) throw new Error('Archivo original bloqueado');

        const fullData = await res.json();

        if (fullData && !fullData.error) {
            const mergedCircle = { ...circle, ...fullData, _isFullDetails: true };
            if (index !== -1) window.CRM.APP.circles[index] = mergedCircle;
            return mergedCircle;
        } else {
            throw new Error('Datos vacíos');
        }
    } catch (e) {
        alert('⚠️ Servidor saturado. No se descargaron las fotos pesadas.');
        return circle;
    }
};

// ====================================================================
// 3. RUTAS DE ESCRITURA
// ====================================================================

window.saveCircleToCloud = async function(circleData) {
    const response = await apiFetch(`${window.API_URL}?action=save_circle`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(circleData)
    });

    if (!response.ok) {
        actualizarSemaforo('red');
        throw new Error(`Colapso (${response.status})`);
    }

    const res = await response.json();
    if (res.status !== 'success') {
        actualizarSemaforo('red');
        throw new Error(res.message || 'Error desconocido');
    }
    actualizarSemaforo('green');
    return res;
};

window.saveUserToCloud = async function(userData) {
    const _doSave = async (payload) => {
        const r = await apiFetch(`${window.API_URL}?action=save_user`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
        });
        return await r.json();
    };

    let res = await _doSave(userData);

    // Duplicate state-delegado warning (HTTP 409)
    if (res.status === 'warning' && res.suggest_municipal) {
        const ok = confirm(
            res.message +
            '\n\n¿Deseas crearlo de todas formas como delegado estatal adicional?\n' +
            '(Para asignarlo al rol municipal correcto, usa "Ordenar Delegados" después.)'
        );
        if (!ok) throw new Error('CANCELADO');
        res = await _doSave({ ...userData, force_create: true });
    }

    if (res.status !== 'success') throw new Error(res.message);

    const existingIdx = window.CRM.APP.users.findIndex(u => u.usuario === userData.usuario);
    const sanitized   = { ...userData };
    delete sanitized.password;
    if (existingIdx >= 0) window.CRM.APP.users[existingIdx] = sanitized;
    else window.CRM.APP.users.push(sanitized);

    return res;
};

window.saveEventToCloud = async function(eventData) {
    const response = await apiFetch(`${window.API_URL}?action=save_event`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(eventData)
    });
    return await response.json();
};

window.deleteItemCloud = async function(type, id) {
    const response = await apiFetch(`${window.API_URL}?action=delete_item`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type, id })
    });
    return await response.json();
};

window.deleteCircleFromCloud = async function(circleData) {
    const uid = circleData._db_uid || circleData.unique_id;
    if (!uid) throw new Error('Sin ID');
    return await window.deleteItemCloud('circle', uid);
};

window.deleteUserFromCloud = async function(username) {
    const response = await apiFetch(`${window.API_URL}?action=delete_item`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: 'user', id: username })
    });

    if (!response.ok) throw new Error('Error de comunicación con el servidor al eliminar.');

    const result = await response.json();
    if (result.status !== 'deleted' && result.status !== 'success') {
        throw new Error(result.message || 'No se pudo eliminar el registro en la base de datos.');
    }
    return result;
};

window.saveTrafficToCloud = async function(rules) {
    const response = await apiFetch(`${window.API_URL}?action=save_config`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ trafficRules: rules, customRoles: window.CRM.APP.customRoles })
    });

    if (!response.ok) throw new Error('El servidor bloqueó la escritura. Verifica la conexión.');

    const res = await response.json();
    if (res.status !== 'success') throw new Error('Error en el servidor al intentar guardar en la Base de Datos.');
};

// ====================================================================
// 4. RADAR DE USUARIOS Y SEMÁFORO (HEARTBEAT)
// ====================================================================

function iniciarHeartbeat() {
    if (!window.CRM?.currentUser) return;

    const pingServer = async () => {
        const startPing = Date.now();
        try {
            const res = await apiFetch(`${window.API_URL}?action=ping_user`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({})
            });
            if (res.ok) {
                const latencia = Date.now() - startPing;
                if      (latencia < 800)  actualizarSemaforo('green');
                else if (latencia < 3000) actualizarSemaforo('yellow');
                else                      actualizarSemaforo('red');

                // v15.27 — Procesar payload del ping
                try {
                    const data = await res.clone().json();
                    // Force logout (enviado desde consola admin)
                    if (data && data.status === 'force_logout') {
                        window._handleForceLogout(data.message);
                        return;
                    }
                    // Mantenimiento
                    if (data && data.maintenance) {
                        window._handleMaintenanceStatus(data.maintenance);
                    }
                    // Anuncio global
                    if (data && data.announcement !== undefined) {
                        window._handleAnnouncement(data.announcement);
                    }
                } catch(_) {}

            } else if (res.status === 401) {
                // Force logout o sesión expirada
                try {
                    const data = await res.json();
                    if (data && data.status === 'force_logout') {
                        window._handleForceLogout(data.message);
                        return;
                    }
                } catch(_) {}
                actualizarSemaforo('red');
            } else if (res.status === 503) {
                // Modo mantenimiento activo — bloqueo total
                try {
                    const data = await res.json();
                    if (data && data.maintenance) window._handleMaintenanceStatus(data.maintenance);
                } catch(_) {}
                actualizarSemaforo('red');
            } else {
                actualizarSemaforo('red');
            }
        } catch (e) {
            actualizarSemaforo('red');
        }
    };

    pingServer();
    setInterval(pingServer, 20000);
}

// ── v15.26: Gestión de estado de mantenimiento en el cliente ─────────────
window._handleMaintenanceStatus = function(maint) {
    const esAdmin = window.hasPermission && window.hasPermission('centro_mando');
    const activo  = maint && maint.activo;
    const modo    = maint?.modo || 'banner';
    const mensaje = maint?.mensaje || 'El sistema está en mantenimiento. Por favor regresa en unos minutos.';

    // ── Modo BLOQUEO: overlay de pantalla completa para no-admins ──────
    if (activo && modo === 'bloqueo' && !esAdmin) {
        let overlay = document.getElementById('maintenanceOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'maintenanceOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(26,35,126,0.96);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;padding:40px;';
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = `
            <div style="font-size:64px;margin-bottom:20px;">🛡️</div>
            <h2 style="margin:0 0 12px;font-size:24px;font-weight:bold;">Sistema en Mantenimiento</h2>
            <p style="font-size:16px;max-width:460px;opacity:0.85;margin:0 0 24px;line-height:1.6;">${mensaje}</p>
            <div style="background:rgba(255,255,255,0.1);border-radius:12px;padding:16px 28px;font-size:13px;opacity:0.7;">
                🔄 Esta pantalla se actualizará automáticamente cuando el sistema esté disponible
            </div>`;
        overlay.style.display = 'flex';
        return;
    }

    // Quitar overlay si el modo cambia o se desactiva
    const overlay = document.getElementById('maintenanceOverlay');
    if (overlay) overlay.style.display = 'none';

    // ── Modo BANNER: barra informativa en la parte superior ────────────
    let banner = document.getElementById('maintenanceBanner');
    if (activo) {
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'maintenanceBanner';
            banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;background:#e65100;color:#fff;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:bold;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
            document.body.appendChild(banner);
            document.body.style.paddingTop = '44px';
        }
        const labelModo = esAdmin ? ` <span style="background:rgba(255,255,255,0.25);padding:2px 8px;border-radius:10px;font-size:11px;">${modo.toUpperCase()}</span>` : '';
        banner.innerHTML = `
            <span>⚠️ ${mensaje}${labelModo}</span>
            ${esAdmin
                ? `<button onclick="window.desactivarMantenimiento()" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.5);color:#fff;padding:4px 14px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;margin-left:16px;">✅ Desactivar</button>`
                : `<button onclick="this.closest('#maintenanceBanner').style.display='none';document.body.style.paddingTop=''" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;margin-left:16px;opacity:0.7;">×</button>`
            }`;
    } else {
        if (banner) { banner.style.display = 'none'; document.body.style.paddingTop = ''; }
    }
};

window.desactivarMantenimiento = async function() {
    try {
        const res  = await apiFetch(`${window.API_URL}?action=set_maintenance`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ activo: false, modo: 'banner', mensaje: '' })
        });
        const data = await res.json();
        if (data.status === 'success') {
            window._handleMaintenanceStatus({ activo: false });
            if (typeof window.renderMaintenancePanel === 'function') window.renderMaintenancePanel();
        }
    } catch(e) { console.warn('Error al desactivar mantenimiento:', e); }
};

// ── v15.28: Force logout desde consola admin ──────────────────────────────
window._handleForceLogout = function(mensaje) {
    // Limpiar estado local
    try {
        localStorage.removeItem(window.CRM?.STORAGE_KEY || 'cc_crm_v6_validacion');
        localStorage.removeItem(window.CRM?.STORAGE_KEY_USER || 'cc_crm_user_v6');
    } catch(_) {}

    // Mostrar pantalla de cierre forzado
    let overlay = document.getElementById('forceLogoutOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'forceLogoutOverlay';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:99999',
            'background:rgba(15,23,42,0.97)',
            'display:flex', 'flex-direction:column',
            'align-items:center', 'justify-content:center',
            'font-family:system-ui,sans-serif', 'text-align:center', 'padding:24px'
        ].join(';');
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
        <div style="font-size:52px;margin-bottom:16px;">🔐</div>
        <h2 style="color:#e2e8f0;margin-bottom:8px;font-size:22px;">Sesión cerrada por el administrador</h2>
        <p style="color:#94a3b8;max-width:400px;margin-bottom:24px;font-size:14px;">
            ${mensaje || 'El administrador del sistema ha cerrado todas las sesiones activas.'}
        </p>
        <button onclick="location.reload()"
            style="background:#f97316;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;">
            🔄 Ir al login
        </button>
    `;
};

// ── v15.28: Anuncios globales desde consola admin ─────────────────────────
let _lastAnnouncementMsg = '';
window._handleAnnouncement = function(ann) {
    const bannerEl = document.getElementById('announcementBanner');
    if (!ann || !ann.activo || !ann.mensaje) {
        if (bannerEl) { bannerEl.style.display = 'none'; document.body.style.paddingTop = ''; }
        _lastAnnouncementMsg = '';
        return;
    }
    // Evitar re-renderizar si no cambió
    if (ann.mensaje === _lastAnnouncementMsg) return;
    _lastAnnouncementMsg = ann.mensaje;

    const colores = {
        info:    { bg: '#1e40af', border: '#3b82f6', text: '#bfdbfe' },
        warning: { bg: '#92400e', border: '#f59e0b', text: '#fef3c7' },
        success: { bg: '#14532d', border: '#22c55e', text: '#bbf7d0' },
        danger:  { bg: '#7f1d1d', border: '#ef4444', text: '#fee2e2' },
    };
    const c = colores[ann.tipo || 'info'] || colores.info;
    const icons = { info:'ℹ️', warning:'⚠️', success:'✅', danger:'🚨' };

    let banner = document.getElementById('announcementBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'announcementBanner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9997;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;font-family:system-ui,sans-serif;font-size:13px;font-weight:500;';
        document.body.appendChild(banner);
    }
    banner.style.background    = c.bg;
    banner.style.borderBottom  = `1px solid ${c.border}`;
    banner.style.color         = c.text;
    banner.style.display       = 'flex';
    banner.innerHTML = `
        <span>${icons[ann.tipo || 'info'] || 'ℹ️'} ${ann.mensaje}</span>
        <button onclick="this.closest('#announcementBanner').style.display='none';document.body.style.paddingTop=''"
            style="background:none;border:none;color:${c.text};font-size:18px;cursor:pointer;opacity:0.7;margin-left:16px;line-height:1;">×</button>
    `;
    document.body.style.paddingTop = (parseInt(document.body.style.paddingTop) || 0) > 40
        ? document.body.style.paddingTop
        : '42px';
};

function crearSemaforoUI() {
    if (document.getElementById('server-traffic-light')) return;
    const ui    = document.createElement('div');
    ui.id       = 'server-traffic-light';
    ui.style.cssText = 'position:fixed;bottom:20px;left:20px;background:rgba(0,0,0,0.8);color:white;padding:8px 12px;border-radius:20px;font-size:11px;z-index:9999;display:flex;align-items:center;gap:8px;font-family:sans-serif;box-shadow:0 4px 6px rgba(0,0,0,0.3);backdrop-filter:blur(5px);';
    ui.innerHTML = `
        <div id="stl-dot" style="width:12px;height:12px;border-radius:50%;background:#28a745;box-shadow:0 0 8px #28a745;"></div>
        <span id="stl-text" style="font-weight:bold;letter-spacing:0.5px;">SERVIDOR ESTABLE</span>
    `;
    document.body.appendChild(ui);
}

function actualizarSemaforo(color) {
    window.CRM.serverStatus = color;
    const dot = document.getElementById('stl-dot');
    const txt = document.getElementById('stl-text');
    if (!dot || !txt) return;

    if (color === 'green') {
        dot.style.background = '#28a745'; dot.style.boxShadow = '0 0 8px #28a745';
        txt.textContent = 'SERVIDOR ESTABLE';
    } else if (color === 'yellow') {
        dot.style.background = '#ffc107'; dot.style.boxShadow = '0 0 8px #ffc107';
        txt.textContent = 'TRÁFICO ALTO';
    } else {
        dot.style.background = '#dc3545'; dot.style.boxShadow = '0 0 8px #dc3545';
        txt.textContent = 'MODO OFFLINE (SATURADO)';
    }
}

// ====================================================================
// 5. BANDA TRANSPORTADORA (BACKGROUND SYNC)
// ====================================================================

window.queueOfflineCircle = function(circleData) {
    let queue      = JSON.parse(localStorage.getItem('crm_sync_queue')) || [];
    circleData._isOffline = true;
    queue.push(circleData);
    localStorage.setItem('crm_sync_queue', JSON.stringify(queue));

    if (window.CRM.APP.circles) window.CRM.APP.circles.unshift(circleData);

    alert('⚠️ Servidor saturado. Tu círculo ha sido guardado a salvo en tu teléfono. Se sincronizará automáticamente en unos minutos.');
    if (window.applyCircleListFilters) window.applyCircleListFilters();
    return true;
};

window.processSyncQueue = async function() {
    if (window.isSyncing || window.CRM.serverStatus === 'red') return;

    let queue = JSON.parse(localStorage.getItem('crm_sync_queue')) || [];
    if (queue.length === 0) {
        const badge = document.getElementById('sync-badge');
        if (badge) badge.remove();
        return;
    }

    window.isSyncing = true;

    let badge = document.getElementById('sync-badge');
    if (!badge) {
        badge           = document.createElement('div');
        badge.id        = 'sync-badge';
        badge.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#0d47a1;color:#fff;padding:6px 15px;border-radius:20px;font-size:12px;z-index:9999;font-weight:bold;box-shadow:0 4px 6px rgba(0,0,0,0.3);';
        document.body.appendChild(badge);
    }
    badge.textContent = `🔄 Subiendo ${queue.length} actas en fila...`;

    try {
        const circleToSync = queue[0];
        const localUid     = circleToSync.unique_id;
        delete circleToSync._isOffline;

        await window.saveCircleToCloud(circleToSync);

        queue.shift();
        localStorage.setItem('crm_sync_queue', JSON.stringify(queue));

        const localCircle = window.CRM.APP.circles.find(c => c.unique_id === localUid);
        if (localCircle) delete localCircle._isOffline;

        window.isSyncing = false;

        if (queue.length > 0) {
            setTimeout(window.processSyncQueue, 3000);
        } else {
            badge.textContent = '✅ Sincronización completada';
            setTimeout(() => badge.remove(), 3000);
            if (window.applyCircleListFilters) window.applyCircleListFilters();
        }
    } catch (e) {
        console.warn('Fallo banda transportadora, esperando a que mejore la red...');
        actualizarSemaforo('red');
        window.isSyncing  = false;
        badge.textContent = '⏸️ Red inestable. Pausado.';
    }
};

window.loadLocalBackup = function() {
    const backup = localStorage.getItem('crm_backup_circles');
    if (backup) {
        console.warn('⚠️ Usando copia local de emergencia.');
        window.CRM.APP.circles = JSON.parse(backup);

        const queue = JSON.parse(localStorage.getItem('crm_sync_queue')) || [];
        if (queue.length > 0) {
            window.CRM.APP.circles = [...queue, ...window.CRM.APP.circles];
        }

        if (window.updateStats) window.updateStats();
    }
};

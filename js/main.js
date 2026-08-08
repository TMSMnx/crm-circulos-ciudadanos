/**
 * main.js
 * Orquestador principal. Configura listeners y gestiona el Modo Offline.
 * Versión: 12.0 (Seguridad consolidada en auth.js — sin duplicados)
 *
 * NOTA: DEFAULT_PERMISSIONS, hasPermission y el manejo de sesión
 *       viven exclusivamente en auth.js. Este archivo solo registra
 *       event-listeners y extiende applyUIBasedOnPermissions.
 */

// ====================================================================
// RBAC EXTENDIDO — extiende lo que auth.js inicializa
// (auth.js define la función base; aquí la sobreescribimos con más
//  elementos de UI específicos del dashboard)
// ====================================================================
window.applyUIBasedOnPermissions = function() {
    const hasPerm = window.hasPermission;
    const user    = window.CRM?.currentUser;

    const btnCreate = document.getElementById('btnCreateUser');
    if (btnCreate) btnCreate.style.display = hasPerm('create_users') ? 'inline-block' : 'none';

    const btnViewAll = document.querySelector('button[onclick="showUserList(\'all\')"]');
    if (btnViewAll) btnViewAll.style.display = hasPerm('view_all_users') ? 'inline-block' : 'none';

    const btnRepEst = document.getElementById('btnReporteEstados');
    if (btnRepEst) btnRepEst.style.display = hasPerm('view_state_reports') ? 'inline-block' : 'none';

    const btnRepCirc = document.getElementById('btnReporteCircunscripciones');
    if (btnRepCirc) btnRepCirc.style.display = hasPerm('view_circ_reports') ? 'inline-block' : 'none';

    const btnCentro = document.querySelector('button[onclick="window.abrirCentroMando()"]');
    if (btnCentro) btnCentro.style.display = hasPerm('centro_mando') ? 'inline-block' : 'none';

    const esAltoMando   = user && ['admin', 'superadmin', 'coordinador_nacional', 'secretario_nacional'].includes(user.rol);
    const esMandoEstatal = user && user.rol === 'secretario_estatal';

    const btnRadar = document.getElementById('btnRadar');
    if (btnRadar) btnRadar.style.display = (esAltoMando || esMandoEstatal) ? 'inline-block' : 'none';

    const btnExcel = document.getElementById('btnExportarExcel');
    if (btnExcel) btnExcel.style.display = esAltoMando ? 'inline-block' : 'none';

    const btnRescate = document.getElementById('btnRescateCirculos');
    if (btnRescate) btnRescate.style.display = esAltoMando ? 'inline-block' : 'none';
};

// ====================================================================
// INICIO DE LA APLICACIÓN — solo event listeners
// (la sesión es manejada completamente por auth.js)
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {

    // Ocultar splash
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.classList.add('fade-out-splash');
            setTimeout(() => splash.style.display = 'none', 600);
        }
        const dbLoader = document.getElementById('db-loading-indicator');
        if (dbLoader) dbLoader.style.display = 'none';
    }, 1500);

    // Perfil
    document.getElementById('btnEditProfile')?.addEventListener('click', () => {
        if (typeof window.openProfileModal === 'function') window.openProfileModal();
    });

    document.getElementById('formProfile')?.addEventListener('submit', (e) => {
        if (typeof window.handleSaveProfile === 'function') window.handleSaveProfile(e);
    });

    // Crear círculo
    document.getElementById('btnCreateCircle')?.addEventListener('click', () => {
        const user = window.CRM.currentUser;
        if (!user) return alert('Sesión inválida, por favor recarga.');

        const today = new Date().getDay();
        const rules = (window.CRM.APP.trafficRules && window.CRM.APP.trafficRules[today])
            ? window.CRM.APP.trafficRules[today]
            : { states: 'ALL', roles: 'ALL' };

        let accessGranted = false;
        if (window.hasPermission('centro_mando')) {
            accessGranted = true;
        } else if (rules.states === 'ALL' || (user.estado && rules.states.includes(user.estado))) {
            accessGranted = true;
        } else if (rules.roles === 'ALL' || (user.rol && rules.roles.includes(user.rol))) {
            accessGranted = true;
        }

        if (!accessGranted) {
            const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
            alert(`⛔ ACCESO RESTRINGIDO HOY (${dias[today]})\n\nTu estado/rol no tiene turno hoy.`);
            return;
        }

        document.getElementById('formActa').reset();
        document.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = false);
        if (typeof window.renderCircleOptions === 'function') window.renderCircleOptions();
        window.openModal('modalSelectCircleType');
    });

    // OCR / INE
    const ocrInput = document.getElementById('cedula_ine');
    if (ocrInput) {
        ocrInput.addEventListener('change', async (e) => {
            if (window.handleIneUpload) await window.handleIneUpload(e);
            else console.error('Error: ocr-engine.js no está cargado.');
        });
    }

    // Tipo de círculo
    document.getElementById('btnTypeLudico')?.addEventListener('click', () => {
        window.closeModal('modalSelectCircleType');
        window.openModal('modalSelectActivities');
    });
    document.getElementById('btnTypeCausas')?.addEventListener('click', () => {
        window.closeModal('modalSelectCircleType');
        window.openModal('modalSelectCauses');
    });

    // Formularios de círculo
    document.getElementById('btnActivitiesContinue')?.addEventListener('click', window.handleActivitiesContinue);
    document.getElementById('btnCausesContinue')?.addEventListener('click', window.handleCausesContinue);
    document.getElementById('formActa')?.addEventListener('submit', window.handleGeneratePDFAndSave);
    document.getElementById('btnNextIntegrante')?.addEventListener('click', window.handleNextIntegrante);
    document.getElementById('btnFinalizarCirculo')?.addEventListener('click', window.handleFinalizarCirculo);

    document.getElementById('btnClearSig')?.addEventListener('click', () => {
        const canvas = document.getElementById('sigCanvas');
        if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }
    });

    // Gestión de usuarios
    document.getElementById('btnCreateUser')?.addEventListener('click', () => {
        if (window.CRM) window.CRM.editingUser = null;
        if (typeof window.populateStatesSelect === 'function') window.populateStatesSelect();
        if (typeof window.populateRolesSelect === 'function') window.populateRolesSelect();

        document.getElementById('formCreateUser').reset();
        document.getElementById('u_id').value = '';
        document.getElementById('u_usuario').removeAttribute('readonly');
        document.getElementById('u_foto_preview').style.display = 'none';
        document.querySelector('#modalCreateUser h3').textContent = '👤 Crear Nuevo Coordinador';

        const inputPass = document.getElementById('u_password');
        if (inputPass) {
            inputPass.type = 'password';
            let eye = inputPass.parentElement.querySelector('.toggle-eye');
            if (!inputPass.parentElement.classList.contains('password-container')) {
                const wrapper     = document.createElement('div');
                wrapper.className = 'password-container';
                inputPass.parentNode.insertBefore(wrapper, inputPass);
                wrapper.appendChild(inputPass);
                eye           = document.createElement('i');
                eye.className = 'toggle-eye';
                wrapper.appendChild(eye);
            }
            if (eye) {
                eye.textContent = '👁️';
                eye.onclick     = function() {
                    if (inputPass.type === 'password') {
                        inputPass.type   = 'text';
                        this.textContent = '🙈';
                    } else {
                        inputPass.type   = 'password';
                        this.textContent = '👁️';
                    }
                };
            }
        }
        window.openModal('modalCreateUser');
    });

    document.getElementById('formCreateUser')?.addEventListener('submit', window.handleUserFormSubmit);

    document.getElementById('formNewRole')?.addEventListener('submit', (e) => {
        if (window.handleCreateRole) window.handleCreateRole(e);
        else { e.preventDefault(); alert('El módulo de administración está cargando, intenta de nuevo.'); }
    });

    // Reportes
    document.getElementById('btnReporteEstados')?.addEventListener('click', () => {
        if (typeof window.populateReportStates === 'function') window.populateReportStates();
        window.openModal('modalReporteEstados');
    });

    document.getElementById('btnRunStateReport')?.addEventListener('click', window.runStateReport);

    document.getElementById('btnExportarReportePDF')?.addEventListener('click', () => {
        if      (typeof window.handleExportStatePDF  === 'function') window.handleExportStatePDF();
        else if (typeof window.exportStateReportPDF  === 'function') window.exportStateReportPDF();
        else alert('Motor PDF no cargado');
    });

    document.getElementById('btnReporteCircunscripciones')?.addEventListener('click', () => {
        window.openModal('modalReporteCircunscripciones');
        if (typeof window.runCircunscripcionReport === 'function') window.runCircunscripcionReport();
    });

    // Mapa
    document.getElementById('btnMapaInteractivo')?.addEventListener('click', () => {
        if (typeof window.abrirMapaInteractivo === 'function') window.abrirMapaInteractivo();
        else alert('El módulo de mapas se está cargando, intenta en unos segundos.');
    });

    // Eventos
    document.getElementById('btnMisEventos')?.addEventListener('click', () => {
        window.openModal('modalEventos');
        if (typeof window.renderCalendar === 'function') window.renderCalendar();
        if (typeof window.populateEventRoleFilters === 'function') window.populateEventRoleFilters();
    });
    document.getElementById('eventForm')?.addEventListener('submit', window.handleSaveEvent);
    document.getElementById('btnDeleteEvent')?.addEventListener('click', window.deleteEvent);

    // Cerrar modales
    document.querySelectorAll('.modal .close').forEach(el =>
        el.addEventListener('click', (e) => window.closeModal(e.target.dataset.target))
    );

    // Canvas de firma
    const canvas = document.getElementById('sigCanvas');
    if (canvas) {
        const ctx       = canvas.getContext('2d');
        ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        let drawing     = false;

        const getPos = (e) => {
            const rect    = canvas.getBoundingClientRect();
            const clientX = e.clientX || e.touches?.[0]?.clientX;
            const clientY = e.clientY || e.touches?.[0]?.clientY;
            if (!clientX) return { x: 0, y: 0 };
            return {
                x: (clientX - rect.left) * (canvas.width / rect.width),
                y: (clientY - rect.top)  * (canvas.height / rect.height)
            };
        };

        const start = (e) => { if (e.type !== 'mousedown') e.preventDefault(); drawing = true; ctx.beginPath(); const p = getPos(e); ctx.moveTo(p.x, p.y); };
        const move  = (e) => { if (e.type !== 'mousemove') e.preventDefault(); if (!drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
        const end   = (e) => { if (e.type !== 'mouseup')   e.preventDefault(); drawing = false; };

        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        document.addEventListener('mouseup', end);
        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove',  move,  { passive: false });
        canvas.addEventListener('touchend',   end);
    }

    // Municipios al cambiar estado
    const actaEstado = document.getElementById('acta_estado');
    if (actaEstado) {
        actaEstado.addEventListener('change', function() {
            if (window.popularMunicipios) window.popularMunicipios(this.value, 'acta_municipio');
        });
    }

    // Interceptor de modales para auto-rellenar municipios
    const originalOpenModal = window.openModal;
    if (typeof originalOpenModal === 'function') {
        window.openModal = function(modalId) {
            originalOpenModal(modalId);
            setTimeout(() => {
                if (modalId === 'modalActa') {
                    const sel = document.getElementById('acta_estado');
                    if (sel?.value && window.popularMunicipios) window.popularMunicipios(sel.value, 'acta_municipio');
                }
                if (modalId === 'modalCreateUser') {
                    const sel = document.getElementById('u_estado');
                    if (sel?.value && sel.value !== 'Nacional' && window.popularMunicipios) window.popularMunicipios(sel.value, 'u_municipio');
                }
            }, 150);
        };
    }
});

// ====================================================================
// GESTOR DE SINCRONIZACIÓN OFFLINE
// ====================================================================

window.addEventListener('online',  () => window.checkOfflineStatus());
window.addEventListener('offline', () => window.checkOfflineStatus());

window.checkOfflineStatus = function() {
    const pending  = JSON.parse(localStorage.getItem('crm_offline_circles')) || [];
    const alertBox = document.getElementById('offlineSyncAlert');
    const countSpan = document.getElementById('offlineCount');
    const btnSync  = document.getElementById('btnSyncNow');

    if (pending.length > 0) {
        if (alertBox)  alertBox.style.display = 'flex';
        if (countSpan) countSpan.textContent  = pending.length;
        if (btnSync) {
            btnSync.disabled    = !navigator.onLine;
            btnSync.textContent = navigator.onLine
                ? `🔄 Subir Ahora (${pending.length})`
                : `Sin Conexión (${pending.length})`;
            btnSync.style.opacity = navigator.onLine ? '1' : '0.6';
            btnSync.style.cursor  = navigator.onLine ? 'pointer' : 'not-allowed';
        }
    } else {
        if (alertBox) alertBox.style.display = 'none';
    }
};

document.getElementById('btnSyncNow')?.addEventListener('click', async () => {
    const pending = JSON.parse(localStorage.getItem('crm_offline_circles')) || [];
    if (pending.length === 0) return;
    if (!navigator.onLine) return alert('No tienes conexión a internet.');
    if (!confirm(`¿Estás listo para subir ${pending.length} círculos a la nube?`)) return;

    const btn          = document.getElementById('btnSyncNow');
    const originalText = btn.textContent;
    btn.disabled       = true;
    btn.textContent    = 'Subiendo...';

    let successCount = 0;
    let failedItems  = [];

    for (const circle of pending) {
        try {
            delete circle._isOffline;
            if (typeof window.saveCircleToCloud === 'function') {
                await window.saveCircleToCloud(circle);
                successCount++;
            } else {
                throw new Error('Función de API no encontrada.');
            }
        } catch (e) {
            console.error('Error subiendo círculo:', e);
            circle._isOffline = true;
            failedItems.push(circle);
        }
    }

    localStorage.setItem('crm_offline_circles', JSON.stringify(failedItems));
    alert(`Proceso finalizado.\n\n✅ Subidos: ${successCount}\n❌ Pendientes: ${failedItems.length}`);

    btn.disabled    = false;
    btn.textContent = originalText;

    window.checkOfflineStatus();
    if (successCount > 0) window.location.reload();
});

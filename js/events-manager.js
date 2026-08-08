/**
 * events-manager.js
 * Módulo de Calendario, Gestión de Eventos, Invitados y Escáner QR.
 * Versión: 11.3 (Agenda Ciudadana Profesional - Pantalla Dividida)
 */

window.CRM = window.CRM || {};
window.CRM.currentCalendarDate = new Date();
window.CRM.eventFiltersPopulated = false;

// ==========================================
// 1. INICIALIZACIÓN Y DISEÑO DEL MÓDULO
// ==========================================

// Re-estructurar el HTML del modal de eventos para pantalla dividida
window.initEventModuleLayout = function() {
    const modalContent = document.querySelector('#modalEventos .modal-content');
    if (!modalContent || modalContent.dataset.layoutReady) return;

    // Creamos la estructura de pantalla dividida
    const headerHtml = `
        <span class="close" data-target="modalEventos" onclick="document.getElementById('modalEventos').style.display='none'">×</span>
        <h3 style="color: #673ab7; margin-top: 0; border-bottom: 2px solid #673ab7; padding-bottom: 10px;">
            <span style="font-size: 24px;">🗓️</span> Agenda Ciudadana
        </h3>
    `;

    const splitLayoutHtml = `
        <div style="display: flex; flex-wrap: wrap; gap: 20px; height: calc(90vh - 80px);">
            <div style="flex: 1; min-width: 300px; display: flex; flex-direction: column;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                    <button class="primary-btn" onclick="window.showEventForm()" style="margin: 0; background: #28a745;">➕ Nuevo Evento</button>
                    <button class="secondary-btn" onclick="window.renderCalendar()" style="margin: 0;">🔄 Refrescar</button>
                </div>
                
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #f4f7f6; border-radius: 8px; border: 1px solid #ddd;">
                    <button class="secondary-btn small-btn" onclick="window.changeMonth(-1)" style="margin:0;">◀ Ant.</button>
                    <h4 id="month-year-display" style="margin: 0; color: #ff7e00; font-size: 16px;"></h4>
                    <button class="secondary-btn small-btn" onclick="window.changeMonth(1)" style="margin:0;">Sig. ▶</button>
                </div>
                
                <div class="calendar-grid" style="margin-top: 10px;">
                    <div class="calendar-header">DOM</div>
                    <div class="calendar-header">LUN</div>
                    <div class="calendar-header">MAR</div>
                    <div class="calendar-header">MIÉ</div>
                    <div class="calendar-header">JUE</div>
                    <div class="calendar-header">VIE</div>
                    <div class="calendar-header">SÁB</div>
                </div>
                <div id="calendar-body" class="calendar-grid" style="flex-grow: 1; overflow-y: auto;">
                    </div>
            </div>

            <div id="event-editor-panel" style="flex: 1.2; min-width: 320px; background: #fdfdfd; border: 1px solid #ddd; border-radius: 8px; padding: 15px; overflow-y: auto; display: none;">
                </div>
            
            <div id="event-empty-panel" style="flex: 1.2; min-width: 320px; display: flex; align-items: center; justify-content: center; background: #f9f9f9; border: 1px dashed #ccc; border-radius: 8px; flex-direction: column; color: #999;">
                <span style="font-size: 40px; margin-bottom: 10px;">📅</span>
                <p>Selecciona un día o un evento para editar.</p>
            </div>
        </div>
    `;

    // Extraer el formulario existente antes de reescribir
    const existingFormContainer = document.getElementById('event-form-container');
    const formHtml = existingFormContainer ? existingFormContainer.innerHTML : '';

    // Reescribir el modal
    modalContent.innerHTML = headerHtml + splitLayoutHtml;
    
    // Inyectar el formulario en su nuevo panel
    const editorPanel = document.getElementById('event-editor-panel');
    editorPanel.innerHTML = formHtml;

    // Reconectar evento de guardado al nuevo formulario
    const newForm = editorPanel.querySelector('#eventForm');
    if(newForm) newForm.addEventListener('submit', window.handleSaveEvent);

    modalContent.dataset.layoutReady = "true";
};

// ==========================================
// 2. CALENDARIO VISUAL
// ==========================================

window.renderCalendar = function() {
    window.initEventModuleLayout();

    const date = window.CRM.currentCalendarDate;
    const body = document.getElementById('calendar-body');
    if(!body) return;

    document.getElementById('month-year-display').textContent = date.toLocaleString('es-MX', { month: 'long', year: 'numeric' }).toUpperCase();
    body.innerHTML = '';
    
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();

    // Días vacíos
    for(let i=0; i<firstDay; i++) {
        body.innerHTML += `<div class="calendar-day other-month"></div>`;
    }

    // Días del mes actual
    for(let d=1; d<=daysInMonth; d++) {
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dayEvents = (window.CRM.APP.events || []).filter(e => e.date === dateStr);
        
        let eventHTML = dayEvents.map(ev => 
            `<div class="event-marker" style="background:#e8eaf6; border-left:4px solid #3f51b5; padding:4px; margin-top:4px; border-radius:3px; font-size:10px; cursor:pointer; color:#1a237e; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" 
                  onclick="event.stopPropagation(); window.showEventForm('${ev.id}')" title="${ev.title}">
                🕒 ${ev.time || ''} - ${ev.title}
            </div>`
        ).join('');

        // Resaltar día actual
        const isToday = (dateStr === new Date().toISOString().split('T')[0]);
        const dayStyle = isToday ? 'background: #fff3e0; border: 2px solid #ff7e00;' : '';

        body.innerHTML += `
            <div class="calendar-day" style="${dayStyle} cursor:pointer;" onclick="window.showEventForm(null, '${dateStr}')">
                <span style="${isToday ? 'background:#ff7e00; color:#fff; padding:2px 6px; border-radius:50%;' : ''}">${d}</span>
                ${eventHTML}
            </div>`;
    }
};

window.changeMonth = function(delta) {
    window.CRM.currentCalendarDate.setMonth(window.CRM.currentCalendarDate.getMonth() + delta);
    window.renderCalendar();
};

// ==========================================
// 3. FORMULARIO Y CRUD DE EVENTOS
// ==========================================

window.showEventForm = function(eventId = null, dateStr = null) {
    document.getElementById('event-empty-panel').style.display = 'none';
    const editor = document.getElementById('event-editor-panel');
    editor.style.display = 'block';
    editor.scrollTop = 0; // Volver arriba
    
    // Resetear formulario
    const form = document.getElementById('eventForm');
    form.reset();
    document.getElementById('event_id').value = '';
    document.getElementById('event_invited_users').value = '';
    document.getElementById('event_invite_count').textContent = '0';
    
    const guestManager = document.getElementById('event-guest-manager');
    if(guestManager) guestManager.style.display = 'none';
    
    const btnDelete = document.getElementById('btnDeleteEvent');
    if(btnDelete) btnDelete.style.display = 'none';

    // Poblar filtros de roles y causas si es la primera vez
    window.populateEventRoleFilters();

    if (eventId) {
        // MODO EDICIÓN
        const ev = window.CRM.APP.events.find(e => e.id === eventId);
        if (ev) {
            document.getElementById('event-form-title').textContent = '📝 Editar Evento';
            document.getElementById('event_id').value = ev.id;
            document.getElementById('event_title').value = ev.title;
            document.getElementById('event_date').value = ev.date;
            document.getElementById('event_time').value = ev.time;
            document.getElementById('event_location').value = ev.location;
            document.getElementById('event_map_link').value = ev.mapLink || '';
            document.getElementById('event_description').value = ev.description;
            if(btnDelete) btnDelete.style.display = 'inline-block';
            
            // Cargar Invitados Específicos
            const invitedIds = ev.specificInvites || [];
            document.getElementById('event_invited_users').value = invitedIds.join(',');
            document.getElementById('event_invite_count').textContent = invitedIds.length;

            // Mostrar Gestor de Invitados
            if(guestManager) {
                guestManager.style.display = 'block';
                window.renderEventGuestTable(ev);
            }
        }
    } else {
        // MODO CREACIÓN
        document.getElementById('event-form-title').textContent = '🗓️ Crear Nuevo Evento';
        if (dateStr) document.getElementById('event_date').value = dateStr;
    }
};

window.handleSaveEvent = async function(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "⏳ Guardando...";

    const eventId = document.getElementById('event_id').value;
    
    // Recolectar Invitados Específicos
    const specificInvitesString = document.getElementById('event_invited_users').value;
    const specificInvitesArray = specificInvitesString ? specificInvitesString.split(',') : [];

    // Recolectar Causas (Ahora sincronizadas con CAUSAS_LIST maestra)
    const inviteCauses = Array.from(document.querySelectorAll('input[name="invite_cause"]:checked')).map(c => c.value);

    // Imagen (Manejo robusto)
    const coverInput = document.getElementById('event_cover_image');
    const coverFile = coverInput ? coverInput.files[0] : null;
    let coverData = null;
    if(coverFile) {
        try { coverData = await window.fileToBase64(coverFile); } catch(err){}
    }

    const eventData = {
        id: eventId || `evt_${Date.now()}`,
        title: document.getElementById('event_title').value,
        date: document.getElementById('event_date').value,
        time: document.getElementById('event_time').value,
        location: document.getElementById('event_location').value,
        mapLink: document.getElementById('event_map_link').value,
        description: document.getElementById('event_description').value,
        specificInvites: specificInvitesArray,
        invites: { causes: inviteCauses }, // Agregamos causas
        asistentesConfirmados: [] 
    };
    
    // Preservar imagen anterior y asistentes si es edición
    if (eventId) {
        const oldEv = window.CRM.APP.events.find(e => e.id === eventId);
        if(oldEv) {
            if(!coverData) eventData.coverImage = oldEv.coverImage;
            else eventData.coverImage = coverData;
            eventData.asistentesConfirmados = oldEv.asistentesConfirmados || [];
        }
        // Actualizar array en memoria para repintado instantáneo
        const idx = window.CRM.APP.events.findIndex(e => e.id === eventId);
        if(idx !== -1) window.CRM.APP.events[idx] = eventData;

    } else {
        if(coverData) eventData.coverImage = coverData;
        if(!window.CRM.APP.events) window.CRM.APP.events = [];
        window.CRM.APP.events.push(eventData);
    }

    try {
        if(typeof saveEventToCloud === 'function') {
            await saveEventToCloud(eventData); 
        }
        // Repintado silencioso (sin recargar página)
        window.renderCalendar();
        
        // Efecto visual de éxito
        btn.textContent = "✅ ¡Guardado!";
        setTimeout(() => { 
            btn.disabled = false; 
            btn.textContent = "Guardar Evento"; 
        }, 2000);

    } catch(err) {
        alert("Error al guardar en el servidor: " + err.message);
        btn.disabled = false; btn.textContent = "Reintentar Guardado";
    }
};

window.deleteEvent = async function() {
    const id = document.getElementById('event_id').value;
    if(!id) return;
    if(!confirm("¿Eliminar este evento definitivamente?")) return;
    
    try {
        if(typeof deleteItemCloud === 'function') {
            await deleteItemCloud('event', id);
        }
        
        // Quitar de memoria y repintar
        window.CRM.APP.events = window.CRM.APP.events.filter(e => e.id !== id);
        
        document.getElementById('event-editor-panel').style.display = 'none';
        document.getElementById('event-empty-panel').style.display = 'flex';
        window.renderCalendar();
        
    } catch(err) {
        alert("Error al eliminar: " + err.message);
    }
};

// ==========================================
// 4. GESTIÓN DE INVITADOS (SELECCIÓN MASIVA Y CAUSAS)
// ==========================================

window.populateEventRoleFilters = function() {
    if (window.CRM.eventFiltersPopulated) return;
    
    const causesContainer = document.getElementById('event_cause_filters');

    // 🔥 VINCULACIÓN DIRECTA A LA LISTA OFICIAL DE CAUSAS Y ACTIVIDADES 🔥
    if(causesContainer && typeof CAUSAS_LIST !== 'undefined' && typeof ACTIVIDADES_LIST !== 'undefined') {
        const allTemas = [...CAUSAS_LIST, ...ACTIVIDADES_LIST];
        
        causesContainer.innerHTML = allTemas.map(c => 
            `<label class="cause-card" style="padding:4px; font-size:11px;">
                <input type="checkbox" name="invite_cause" value="${c}"> <span>${c}</span>
             </label>`
        ).join('');
    }
    
    window.CRM.eventFiltersPopulated = true;
};

window.handleSelectInvitesModal = function() {
    const stateSelect = document.getElementById('invite_filter_state');
    const roleSelect = document.getElementById('invite_filter_role');
    
    // Llenar selects si están vacíos
    if (stateSelect.options.length <= 1 && typeof ESTADOS_MX_ADMIN !== 'undefined') {
        stateSelect.innerHTML = '<option value="">Todos los Estados</option>';
        ESTADOS_MX_ADMIN.forEach(e => stateSelect.innerHTML += `<option value="${e}">${e}</option>`);
        
        roleSelect.innerHTML = '<option value="">Todos los Roles</option>';
        if(typeof CORE_ROLES_IDS !== 'undefined' && typeof ROLE_NAMES !== 'undefined') {
            CORE_ROLES_IDS.forEach(r => roleSelect.innerHTML += `<option value="${r}">${ROLE_NAMES[r]}</option>`);
        }
    }

    // Bloqueo de seguridad para usuarios estatales
    const user = window.CRM.currentUser;
    if (user.rol === 'secretario_estatal' || user.rol === 'secretario_municipal') {
        stateSelect.value = user.estado;
        stateSelect.disabled = true;
    }

    // Inyectar botón de selección masiva si no existe
    const filtersDiv = document.querySelector('#modalSelectInvites .filters');
    if(filtersDiv && !document.getElementById('btnSelectAllFiltered')) {
        const btnAll = document.createElement('button');
        btnAll.id = 'btnSelectAllFiltered';
        btnAll.className = 'secondary-btn small-btn';
        btnAll.style.cssText = 'background: #0d47a1; color: white; margin-bottom: 0; margin-left: auto;';
        btnAll.innerHTML = '☑️ Seleccionar Todos los Visibles';
        btnAll.onclick = window.selectAllFilteredInvites;
        filtersDiv.appendChild(btnAll);
    }

    window.applyInviteFilters();
};

window.applyInviteFilters = function() {
    const tbody = document.getElementById('inviteUserListTbody');
    if(!tbody) return;
    tbody.innerHTML = '';

    const nameFilter = document.getElementById('invite_filter_name').value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const stateFilter = document.getElementById('invite_filter_state').value;
    const roleFilter = document.getElementById('invite_filter_role').value;
    
    // Obtener usuarios accesibles según permisos
    const data = window.getAccessibleData ? window.getAccessibleData() : { users: window.CRM.APP.users };
    const users = data.users || [];

    const filtered = users.filter(u => {
        const normName = u.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return normName.includes(nameFilter) &&
               (stateFilter === "" || u.estado === stateFilter) &&
               (roleFilter === "" || u.rol === roleFilter);
    });

    // Marcar los ya seleccionados
    const currentInvitesStr = document.getElementById('event_invited_users').value;
    const currentInvites = currentInvitesStr ? currentInvitesStr.split(',') : [];

    const MAX_RENDER = 200; // Protección de memoria
    let renderCount = 0;

    filtered.forEach(u => {
        if(renderCount >= MAX_RENDER) return;

        const isChecked = currentInvites.includes(u.usuario) ? 'checked' : '';
        
        let displayRole = typeof ROLE_NAMES !== 'undefined' ? (ROLE_NAMES[u.rol] || u.rol) : u.rol;

        tbody.innerHTML += `
            <tr class="invite-row-item">
                <td style="text-align:center;"><input type="checkbox" class="invite-checkbox" data-username="${u.usuario}" ${isChecked}></td>
                <td><strong>${window.toTitleCase(u.nombre)}</strong></td>
                <td><small>${displayRole}</small></td>
                <td>${u.estado}</td>
            </tr>
        `;
        renderCount++;
    });

    if (filtered.length > MAX_RENDER) {
        tbody.innerHTML += `<tr><td colspan="4" style="text-align:center; background:#fff3cd; color:#856404; padding:10px;"><b>⚠️ Mostrando 200 de ${filtered.length} usuarios. Usa los filtros para ser más específico.</b></td></tr>`;
    }
    
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">No se encontraron usuarios.</td></tr>`;
    }
};

// 🔥 NUEVO: SELECCIÓN MASIVA 🔥
window.selectAllFilteredInvites = function() {
    const checkboxes = document.querySelectorAll('.invite-checkbox');
    if (checkboxes.length === 0) return;
    
    // Determinar si vamos a marcar o desmarcar basado en el primer elemento
    const targetState = !checkboxes[0].checked; 
    
    checkboxes.forEach(cb => cb.checked = targetState);
    
    const btn = document.getElementById('btnSelectAllFiltered');
    if(btn) {
        btn.innerHTML = targetState ? '🔲 Desmarcar Todos' : '☑️ Seleccionar Todos los Visibles';
    }
};

window.handleSaveInvitedUsers = function() {
    const checkboxes = document.querySelectorAll('.invite-checkbox');
    let currentIds = document.getElementById('event_invited_users').value ? document.getElementById('event_invited_users').value.split(',') : [];
    
    checkboxes.forEach(cb => {
        const uid = cb.dataset.username;
        if(cb.checked) {
            if(!currentIds.includes(uid)) currentIds.push(uid);
        } else {
            currentIds = currentIds.filter(id => id !== uid);
        }
    });

    document.getElementById('event_invited_users').value = currentIds.join(',');
    document.getElementById('event_invite_count').textContent = currentIds.length;
    window.closeModal('modalSelectInvites');
};

window.renderEventGuestTable = function(event) {
    const tbody = document.getElementById('eventGuestListTbody');
    const previewMsg = document.getElementById('event-preview-msg');
    if(!tbody) return;
    tbody.innerHTML = '';

    // Generar mensaje de vista previa dinámico
    const mapTxt = event.mapLink ? `📍 Mapa: ${event.mapLink}` : '';
    const confirmLink = `https://${window.location.host}/asistencia.php?e=${event.id}`; // Enlace mágico (Requiere Backend extra, preparado a futuro)
    
    const msgBase = `Hola, te invito a *${event.title}*.\n🗓️ ${event.date} a las ${event.time}\n🏢 ${event.location}\n${mapTxt}\n\nConfirma tu asistencia o presenta tu credencial en la puerta.\n\n${event.description}`;
    
    if(previewMsg) previewMsg.innerText = msgBase;

    const invitedIds = event.specificInvites || [];
    const guests = window.CRM.APP.users.filter(u => invitedIds.includes(u.usuario));

    const asistentesSet = new Set(event.asistentesConfirmados || []);

    guests.forEach(u => {
        const phone = u.whatsapp ? u.whatsapp.replace(/\D/g,'') : '';
        let btnHtml = '<span class="small" style="color:#999">Sin Tel</span>';
        
        const yaAsistio = asistentesSet.has(u.nombre);
        const trStyle = yaAsistio ? "background-color: #d4edda; border-left: 4px solid #28a745;" : "";
        const statusIcon = yaAsistio ? "✅ Asistió" : "⏳ Pendiente";

        if(phone.length >= 10 && !yaAsistio) {
            const name = u.nombre.split(' ')[0];
            const personalMsg = encodeURIComponent(`Hola ${name}, te invito a *${event.title}*.\n🗓️ ${event.date} ${event.time}\n🏢 ${event.location}\n${mapTxt}\n\nPor favor, presenta tu credencial QR al llegar.`);
            const link = `https://wa.me/52${phone}?text=${personalMsg}`;
            btnHtml = `<a href="${link}" target="_blank" class="whatsapp-btn secondary-btn small-btn" style="background:#25D366; color:white; text-decoration:none; margin:0;" onclick="this.style.background='#ccc'; this.innerText='Enviado ✅'">📤 Enviar Invitación</a>`;
        } else if (yaAsistio) {
            btnHtml = `<span style="color:#28a745; font-weight:bold;">${statusIcon}</span>`;
        }

        tbody.innerHTML += `
            <tr class="guest-row" style="${trStyle}">
                <td><strong>${window.toTitleCase(u.nombre)}</strong><br><small>${u.usuario}</small></td>
                <td><small>${u.rol}<br>${u.estado}</small></td>
                <td>${u.whatsapp || '-'}</td>
                <td>${btnHtml}</td>
            </tr>
        `;
    });
    
    if(guests.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:15px;">Aún no has seleccionado invitados específicos.</td></tr>`;
    }
};

window.filterEventGuestList = function(mode) {
    document.querySelectorAll('.guest-row').forEach(row => {
        const btn = row.querySelector('.whatsapp-btn');
        if(mode === 'all') row.style.display = '';
        if(mode === 'pending') {
            // Ocultar si ya dice "Enviado" o si no tiene botón
            if(!btn || btn.innerText.includes('Enviado')) row.style.display = 'none';
            else row.style.display = '';
        }
    });
};

// ==========================================
// 5. MODO CADENERO: ESCÁNER QR DE ASISTENCIA
// ==========================================

let html5QrcodeScanner = null;

window.abrirEscanerQR = function(eventId = null) {
    window.eventoActivoParaAsistencia = eventId; 
    document.getElementById('modalScanner').style.display = 'block';
    const resultBox = document.getElementById('scanResult');
    if(resultBox) resultBox.style.display = 'none';

    if (html5QrcodeScanner) html5QrcodeScanner.clear().catch(()=>{});

    // Iniciar cámara con optimización para móviles
    html5QrcodeScanner = new Html5QrcodeScanner(
        "reader", 
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
        false // verbose
    );
    html5QrcodeScanner.render(onScanSuccess);
};

window.cerrarEscaner = function() {
    if (html5QrcodeScanner) html5QrcodeScanner.clear();
    document.getElementById('modalScanner').style.display = 'none';
};

function playTone(freq, type, duration) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
        osc.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + duration);
    } catch(e) {}
}

function showDenied(resultBox, msg) {
    playTone(150, 'sawtooth', 0.3);
    resultBox.innerHTML = `
        <div style="background:#f8d7da; padding:20px; border-radius:8px; border:2px solid #dc3545;">
            <h2 style="color:#721c24; margin:0 0 10px 0;">❌ ACCESO DENEGADO</h2>
            <p style="margin:0; font-weight:bold;">${msg}</p>
        </div>
        <button class="secondary-btn" style="margin-top:15px; width:100%;" onclick="window.reiniciarEscaner()">🔄 Reintentar</button>
    `;
}

async function onScanSuccess(decodedText) {
    html5QrcodeScanner.clear();
    playTone(800, 'sine', 0.1);

    const resultBox = document.getElementById('scanResult');
    resultBox.style.display = 'block';
    resultBox.innerHTML = '<p style="padding:20px; text-align:center; color:#555;">⏳ Verificando en la base de datos...</p>';

    // 1. Parsear QR
    let qrData = null;
    try { qrData = JSON.parse(decodedText); } catch(e) {}

    if (!qrData || (!qrData.n && !qrData.curp)) {
        showDenied(resultBox, 'Código QR no reconocido como credencial de Círculos Ciudadanos.');
        return;
    }

    const curp   = (qrData.curp || '').toUpperCase();
    const nombre = qrData.n || '';

    // 2. Validar contra la base de datos vía API
    let verified = null;
    try {
        const params = new URLSearchParams();
        if (curp)   params.set('curp', curp);
        const res  = await fetch(`api.php?action=validate_credential&${params.toString()}`);
        const data = await res.json();
        if (data.status === 'found') verified = data;
    } catch(e) {
        console.warn('API no disponible, intentando validación local...');
    }

    // 3. Fallback: buscar en los círculos cargados en memoria (modo offline / QR sin CURP)
    if (!verified && (curp || nombre)) {
        const circles = window.CRM?.APP?.circles || [];
        for (const c of circles) {
            const match = c.cedulas?.find(m =>
                (curp   && (m.curp || '').toUpperCase() === curp) ||
                (nombre && (m.nombre || '').toLowerCase() === nombre.toLowerCase())
            );
            if (match) {
                verified = {
                    nombre:    match.nombre,
                    rol:       match.es_coordinador ? 'Coordinador de Círculo' : 'Integrante',
                    circulo:   c.acta?.nombre    || '',
                    estado:    c.acta?.estado    || '',
                    municipio: c.acta?.municipio || '',
                    seccion:   c.acta?.seccion   || match.seccion || '',
                    _local:    true
                };
                break;
            }
        }
    }

    // 4. No encontrado → Acceso denegado
    if (!verified) {
        showDenied(resultBox, 'Esta persona NO está registrada en ningún Círculo Ciudadano.');
        return;
    }

    // 5. ENCONTRADO — mostrar resultado y registrar asistencia si aplica
    const seccionHtml = verified.seccion
        ? `<p style="margin:3px 0 0 0; color:#666; font-size:12px;">🗳️ Sección: ${verified.seccion}</p>` : '';
    const fuenteTag   = verified._local
        ? '<p style="margin:4px 0 0 0; color:#e65100; font-size:11px;">⚠️ Validado localmente (sin conexión)</p>' : '';

    if (window.eventoActivoParaAsistencia) {
        registrarAsistencia(verified.nombre, window.eventoActivoParaAsistencia);
        resultBox.innerHTML = `
            <div style="background:#d4edda; padding:20px; border-radius:8px; border:2px solid #28a745;">
                <h2 style="color:#155724; margin:0 0 8px 0;">✅ ACCESO CONCEDIDO</h2>
                <h3 style="margin:0; color:#333;">${verified.nombre}</h3>
                <p style="margin:5px 0 0 0; color:#666;">${verified.rol}</p>
                <p style="margin:3px 0 0 0; color:#666; font-size:12px;">Círculo: ${verified.circulo}</p>
                ${seccionHtml}${fuenteTag}
                <p style="margin:8px 0 0 0; color:#28a745; font-weight:bold; font-size:12px;">✓ Asistencia Registrada</p>
            </div>
        `;
    } else {
        resultBox.innerHTML = `
            <div style="background:#e3f2fd; padding:20px; border-radius:8px; border:2px solid #0d47a1;">
                <h2 style="color:#0d47a1; margin:0 0 8px 0;">✅ VERIFICADO</h2>
                <h3 style="margin:0; color:#333;">${verified.nombre}</h3>
                <p style="margin:5px 0 0 0; color:#666;">${verified.rol}</p>
                <p style="margin:3px 0 0 0; color:#666; font-size:12px;">Círculo: ${verified.circulo}</p>
                <p style="margin:3px 0 0 0; color:#666; font-size:12px;">${verified.estado} — ${verified.municipio}</p>
                ${seccionHtml}${fuenteTag}
            </div>
        `;
    }
    resultBox.innerHTML += `<button class="primary-btn" style="margin-top:15px; width:100%; padding:15px; font-size:16px;" onclick="window.reiniciarEscaner()">📸 Escanear Siguiente</button>`;
}

window.reiniciarEscaner = function() {
    document.getElementById('scanResult').style.display = 'none';
    html5QrcodeScanner.render(onScanSuccess);
};

async function registrarAsistencia(nombre, eventId) {
    const evento = window.CRM.APP.events.find(e => e.id === eventId);
    if (!evento) return;
    
    if (!evento.asistentesConfirmados) evento.asistentesConfirmados = [];
    
    // Convertir nombre a mayúsculas para búsqueda exacta
    const nombreNormalizado = nombre.toUpperCase();
    
    // Evitar duplicados 
    const yaRegistrado = evento.asistentesConfirmados.find(n => n.toUpperCase() === nombreNormalizado);
    
    if (!yaRegistrado) {
        evento.asistentesConfirmados.push(nombre); // Guardar tal cual viene de la credencial
        
        // Guardar cambios en la nube en segundo plano (silencioso)
        if(typeof saveEventToCloud === 'function') {
            try { await saveEventToCloud(evento); } catch(e) { console.error("Error guardando asistencia en la nube", e); }
        }

        // Si el panel de gestión del evento está abierto detrás del escáner, actualizar la tabla
        if (document.getElementById('event-guest-manager').style.display === 'block') {
             window.renderEventGuestTable(evento);
        }
    }
}
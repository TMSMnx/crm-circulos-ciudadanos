/**
 * admin-manager.js
 * Gestión de Usuarios, Reportes, Centro de Mando RBAC, Mapas y Auditoría de Validación.
 * Versión: 12.1 (Módulo de Analítica Avanzada, Heatmap y Radar de Simuladores)
 */

window.toTitleCase = function(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/(?:^|\s|["'([{])+\S/g, match => match.toUpperCase());
};

window.normalizeText = function(text) {
    if (!text) return "";
    return text.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

// 🔥 MOTOR DE PERMISOS ESTRICTO 🔥
// Permisos disponibles para consulta desde código:
//   create_users | edit_users | delete_items | view_all_users | view_state_reports | view_circ_reports | centro_mando
window.hasPermission = function(perm) {
    const user = window.CRM.currentUser;
    if (!user) return false;

    const role = user.rol;

    // Nivel 1: poder total — true para cualquier permiso
    if (ROLES_NACIONALES_FULL.includes(role)) return true;

    // Nivel 2: lectura nacional — solo permisos de visualización, nunca crear/editar/borrar
    if (ROLES_NACIONALES_READONLY.includes(role)) {
        return ['view_all_users', 'view_state_reports', 'view_circ_reports', 'centro_mando'].includes(perm);
    }

    // Nivel 3+: consulta en cloud perms (personalizados) o DEFAULT_PERMISSIONS
    const cloudPerms = window.CRM.APP.trafficRules?.permissions || {};
    if (cloudPerms[role] && typeof cloudPerms[role][perm] !== 'undefined') {
        return cloudPerms[role][perm] === true;
    }
    if (window.DEFAULT_PERMISSIONS && window.DEFAULT_PERMISSIONS[role]) {
        return window.DEFAULT_PERMISSIONS[role][perm] === true;
    }

    return false;
};

const ESTADOS_MX_ADMIN = [
    "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua",
    "Ciudad de México", "Coahuila", "Colima", "Durango", "Estado de México", "Guanajuato",
    "Guerrero", "Hidalgo", "Jalisco", "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca",
    "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco",
    "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas"
];

const ROLE_NAMES = {
    // ── Nivel 1: Poder Total ───────────────────────────────
    '_nacional': 'Integrantes del Nacional',
    'admin': 'Administrador del Sistema',
    'superadmin': 'Super Administrador',
    'secretario_nacional': 'Secretario Nacional y Staff',
    // ── Nivel 2: Lectura Nacional ──────────────────────────
    'coordinador_nacional': 'Coordinación Nacional',
    // ── Nivel 3: Operativo ────────────────────────────────
    'validacion': 'Mesa de Validación',
    'secretario_estatal': 'Secretario Estatal',
    'secretario_municipal': 'Secretario Municipal',
    'coordinador_distrital_federal': 'Coords. Dist. Feds',
    'coordinador_distrital_local': 'Coord. Dist. Locales',
    'delegado_estatal_jovenes': 'Deleg. Mov. Jóvenes',
    'delegado_estatal_mujeres': 'Deleg. Mov. Mujeres',
    'delegado_estatal_trabajadores': 'Deleg. Trab. y Prod.',
    'delegado_estatal_fundacion': 'Deleg. Fund. Mex Valores',
    'delegado_estatal_productores': 'Deleg. Mov. Productores',
    'coordinador_estatal_usa': 'Mov. Migrante (USA)',
    'presidente_municipal': 'Pres. Mpales',
    'regidor': 'Regidores/Concejales',
    'sindico': 'Síndicos',
    'senador': 'Senadores',
    'diputado_federal': 'Dip. Federales',
    'diputado_local': 'Dip. Locales'
};
const CORE_ROLES_IDS = Object.keys(ROLE_NAMES);

// ── Nivel 1: Roles con privilegios nacionales operativos completos (crear, editar, ver todo) ──
// Fuente única de verdad — usada en UI y validaciones del módulo
const ROLES_NACIONALES_FULL = ['admin', 'superadmin', 'secretario_nacional'];

// ── Roles con permiso de borrado directo (sin cola de solicitud) ──────────────
const ROLES_CON_BORRADO = ['admin', 'superadmin', 'secretario_nacional'];

// ── Roles con visibilidad nacional de solo lectura (sin crear, editar ni borrar) ──
const ROLES_NACIONALES_READONLY = ['coordinador_nacional'];

// ── Espejo del backend $ROLES_ASIGNABLES (api.php save_user) ─────────────────
// Qué roles puede asignar cada rol en el dropdown de creación de usuarios
// REGLA: solo se pueden crear roles de nivel INFERIOR al propio
const ROLES_ASIGNABLES_POR_ROL = {
    'secretario_estatal': [
        'secretario_municipal', 'coordinador_distrital_federal', 'coordinador_distrital_local',
        'regidor', 'sindico', 'diputado_local', 'delegado_especial', 'invitado_especial',
        'delegado_municipal_jovenes', 'delegado_municipal_mujeres',
        'delegado_municipal_trabajadores', 'delegado_municipal_fundacion',
        'delegado_municipal_productores',
    ],
    'delegado_estatal_jovenes':      ['delegado_municipal_jovenes',      'delegado_circunscripcion_jovenes'      ],
    'delegado_estatal_mujeres':      ['delegado_municipal_mujeres',       'delegado_circunscripcion_mujeres'     ],
    'delegado_estatal_trabajadores': ['delegado_municipal_trabajadores',  'delegado_circunscripcion_trabajadores'],
    'delegado_estatal_fundacion':    ['delegado_municipal_fundacion',     'delegado_circunscripcion_fundacion'   ],
    'delegado_estatal_productores':  ['delegado_municipal_productores',   'delegado_circunscripcion_productores' ],
    // Secretario Municipal: nivel bajo, solo puede invitar (no crear coordinadores ni delegados)
    'secretario_municipal':          ['invitado_especial'],
    'coordinador_estatal_usa':       ['coordinador_estatal_usa'],
};

// ==========================================
// 1. ESTADÍSTICAS Y DASHBOARD
// ==========================================

window.initDashboardFilter = function() {
    const select = document.getElementById('dashboardStateFilter');
    if (!select || select.options.length > 1) return;

    ESTADOS_MX_ADMIN.forEach(est => {
        const opt = document.createElement('option');
        opt.value = est; opt.textContent = est;
        select.appendChild(opt);
    });

    const user = window.CRM.currentUser;
    if (user && !window.hasPermission('view_all_users')) {
        select.value = user.estado;
        select.disabled = true;
    }
};

window.updateStats = function() {
    const currentUser = window.CRM.currentUser;
    if (!currentUser) return;

    if (typeof window.applyUIBasedOnPermissions === 'function') window.applyUIBasedOnPermissions();
    window.initDashboardFilter();

    if (ROLES_NACIONALES_FULL.includes(currentUser.rol)) {
        const btnAuditoria = document.getElementById('btnAuditoriaValidacion');
        if (btnAuditoria) btnAuditoria.style.display = 'inline-block';

        const actionGrid = document.querySelector('.action-grid');
        if (actionGrid && !document.getElementById('btnAnaliticaServidor')) {
            const btnAna = document.createElement('button');
            btnAna.id = 'btnAnaliticaServidor';
            btnAna.className = 'secondary-btn';
            btnAna.style.cssText = 'background:#17a2b8; color:#fff; border:none; font-weight:bold; margin-top:10px; width:100%;';
            btnAna.innerHTML = '📈 Analítica y Rendimiento';
            btnAna.onclick = window.abrirAnaliticaServidor;
            actionGrid.appendChild(btnAna);
        }
    }

    const dashboardFilter = document.getElementById('dashboardStateFilter');
    const selectedState = dashboardFilter ? dashboardFilter.value : "";

    const data = (window.getAccessibleData) ? window.getAccessibleData() : { circles: [], users: [] };
    let scopeUsers = data.users || [];
    let scopeCircles = data.circles || [];

    if (window.hasPermission('view_all_users')) {
        if (selectedState && selectedState !== "") {
            scopeUsers = (window.CRM.APP.users || []).filter(u => u.estado === selectedState);
            scopeCircles = (window.CRM.APP.circles || []).filter(c => c.acta.estado === selectedState);
        } else {
            scopeUsers = window.CRM.APP.users || [];
            scopeCircles = window.CRM.APP.circles || [];
        }
    }

    if (document.getElementById('totalCircles'))
        document.getElementById('totalCircles').textContent = scopeCircles.length;

    const totalInt = scopeCircles.reduce((sum, c) => sum + (c.cedulas ? c.cedulas.length : 0), 0);
    if (document.getElementById('totalIntegrantes')) document.getElementById('totalIntegrantes').textContent = totalInt;

    const dynCont = document.getElementById('dynamic-stats-container');
    if (!dynCont) {
        if (typeof window.renderGoalWidget === 'function') window.renderGoalWidget();
        return;
    }
    dynCont.innerHTML = '';

    const overrides = window.CRM.APP.trafficRules?.roleOverrides || {};

    function countRole(roleId) {
        return scopeUsers.filter(u => u.rol === roleId).length;
    }

    function makeCard(roleId, labelOverride, borderColor) {
        const ovr = overrides[roleId] || {};
        if (ovr.hidden) return null;
        const label = ovr.label || labelOverride || ROLE_NAMES[roleId] || roleId;
        const card = document.createElement('div');
        card.className = 'stat-card clickable-stat';
        if (borderColor) card.style.borderBottom = `4px solid ${borderColor}`;
        card.onclick = () => window.showUserList(roleId);
        card.innerHTML = `${label}<span>${countRole(roleId)}</span>`;
        return card;
    }

    function appendRow(cards) {
        const filtered = cards.filter(Boolean);
        if (filtered.length === 0) return;
        const row = document.createElement('div');
        row.className = 'stats-row';
        filtered.forEach(c => row.appendChild(c));
        dynCont.appendChild(row);
    }

    // ── Fila 2: Integrantes del Nacional | Sec. Nacional y Staff | Sec. Estatal ──
    const nacCount = window.hasPermission('view_all_users')
        ? (window.CRM.APP.users || []).filter(u =>
            u.rol === 'admin' || u.rol.startsWith('secretario_') || u.rol.startsWith('titular_')
          ).length
        : 0;
    const nacCard = document.createElement('div');
    nacCard.className = 'stat-card clickable-stat';
    nacCard.onclick = () => window.showUserList('_nacional');
    nacCard.innerHTML = `Integrantes del Nacional<span>${nacCount}</span>`;

    appendRow([
        nacCard,
        makeCard('secretario_nacional'),
        makeCard('secretario_estatal')
    ]);

    // ── Fila 3: Sec. Municipal | Coords. Dist. Feds | Coord. Dist. Locales ──
    appendRow([
        makeCard('secretario_municipal'),
        makeCard('coordinador_distrital_federal'),
        makeCard('coordinador_distrital_local')
    ]);

    // ── Fila 4: Delegados + Campus Naranja ──
    const campusRole = (window.CRM.APP.customRoles || []).find(r =>
        (r.label || '').toLowerCase().includes('campus naranja') ||
        (r.value || '').toLowerCase().includes('campus_naranja')
    );
    const row4 = [
        makeCard('delegado_estatal_jovenes'),
        makeCard('delegado_estatal_mujeres'),
        makeCard('delegado_estatal_trabajadores'),
        makeCard('delegado_estatal_fundacion'),
        makeCard('coordinador_estatal_usa')
    ];
    if (campusRole) {
        const ovr = overrides[campusRole.value] || {};
        if (!ovr.hidden) {
            const cnCard = document.createElement('div');
            cnCard.className = 'stat-card clickable-stat';
            cnCard.style.borderBottom = '4px solid #9c27b0';
            cnCard.onclick = () => window.showUserList(campusRole.value);
            cnCard.innerHTML = `${ovr.label || campusRole.label}<span style="color:#9c27b0;">${countRole(campusRole.value)}</span>`;
            row4.push(cnCard);
        }
    }
    appendRow(row4);

    // ── Fila 5: Pres. Mpales | Regidores/Concejales | Síndicos ──
    appendRow([
        makeCard('presidente_municipal'),
        makeCard('regidor'),
        makeCard('sindico')
    ]);

    // ── Fila 6: Senadores | Dip. Federales | Dip. Locales ──
    appendRow([
        makeCard('senador'),
        makeCard('diputado_federal'),
        makeCard('diputado_local')
    ]);

    // ── Roles custom restantes (excluyendo Campus Naranja) ──
    const remainingCustom = (window.CRM.APP.customRoles || []).filter(r => r !== campusRole);
    if (remainingCustom.length > 0) {
        const customRow = document.createElement('div');
        customRow.className = 'stats-row';
        remainingCustom.forEach(role => {
            const ovr = overrides[role.value] || {};
            if (ovr.hidden) return;
            const label = ovr.label || role.label;
            const card = document.createElement('div');
            card.className = 'stat-card clickable-stat';
            card.style.borderBottom = '4px solid #9c27b0';
            card.onclick = () => window.showUserList(role.value);
            card.innerHTML = `${role.icon ? role.icon + ' ' : ''}${label}<span style="color:#9c27b0;">${countRole(role.value)}</span>`;
            customRow.appendChild(card);
        });
        if (customRow.children.length > 0) dynCont.appendChild(customRow);
    }

    if (typeof window.renderGoalWidget === 'function') window.renderGoalWidget();
};

window.renderGoalWidget = function() {
    const user = window.CRM.currentUser;
    const filterState = document.getElementById('dashboardStateFilter')?.value;
    if (!user || !document.getElementById('goalWidget')) return;
    if (!window.CRM.SECCIONES_POR_ESTADO) return;

    let target = 0, current = 0, regionName = "Nacional";
    let myCircles = window.CRM.APP.circles || [];
    
    if (!window.hasPermission('view_all_users')) {
        myCircles = myCircles.filter(c => c.acta.estado === user.estado);
        regionName = user.estado;
    } else if (filterState && filterState !== "") {
        myCircles = myCircles.filter(c => c.acta.estado === filterState);
        regionName = filterState;
    }

    if (regionName !== "Nacional" && window.CRM.SECCIONES_POR_ESTADO[regionName]) {
        target = Math.ceil(window.CRM.SECCIONES_POR_ESTADO[regionName] * 2.5);
    } else {
        const total = Object.values(window.CRM.SECCIONES_POR_ESTADO).reduce((a, b) => a + b, 0);
        target = Math.ceil(total * 2.5);
        if(target === 0) target = 150000;
    }

    current = myCircles.length;
    const pct = target > 0 ? ((current / target) * 100).toFixed(2) : 0;
    
    document.getElementById('goalTargetName').textContent = regionName;
    document.getElementById('goalCurrent').textContent = current.toLocaleString();
    document.getElementById('goalTarget').textContent = target.toLocaleString();
    document.getElementById('goalPercentageBadge').textContent = pct + '%';
    
    const bar = document.getElementById('goalProgressBar');
    if(bar) bar.style.width = (pct > 100 ? 100 : pct) + '%';
};

window.showUserList = function(roleFilter) {
    document.getElementById('userListRole').value = roleFilter || 'all';
    let displayTitle = ROLE_NAMES[roleFilter] || roleFilter;
    const overrides = window.CRM.APP.trafficRules?.roleOverrides || {};
    if (overrides[roleFilter] && overrides[roleFilter].label) displayTitle = overrides[roleFilter].label;
    
    document.getElementById('userListTitle').textContent = displayTitle !== 'all' ? `Listado: ${displayTitle}` : 'Listado de Usuarios';
    const selectState = document.getElementById('userList_state_select');
    if (selectState) {
        selectState.innerHTML = '<option value="">Todos los Estados</option>';
        ESTADOS_MX_ADMIN.forEach(edo => selectState.innerHTML += `<option value="${edo}">${edo}</option>`);
        if (!window.hasPermission('view_all_users')) {
            selectState.value = window.CRM.currentUser.estado;
            selectState.disabled = true;
        } else {
            selectState.disabled = false;
        }
    }
    window.openModal('modalUserList');
    window.applyUserListFilters();
};

let searchTimeout;
window.handleSearchInput = function() {
    clearTimeout(searchTimeout);
    const tbody = document.getElementById('userListTbody');
    if(tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#666;">⏳ Buscando...</td></tr>';
    searchTimeout = setTimeout(() => { window.applyUserListFilters(); }, 400); 
};

window.applyUserListFilters = function() {
    const tbody = document.getElementById('userListTbody');
    if (!tbody) return;
    let users = window.CRM.APP.users || [];
    if (!window.hasPermission('view_all_users')) {
        const data = (window.getAccessibleData) ? window.getAccessibleData() : { users: [] };
        users = data.users; 
    }
    const roleFilter = document.getElementById('userListRole').value;
    const stateFilter = document.getElementById('userList_state_select').value;
    const searchText = window.normalizeText(document.getElementById('userList_search')?.value || "");
    const overrides = window.CRM.APP.trafficRules?.roleOverrides || {};

    const filtered = users.filter(u => {
        if (searchText) {
            const matchN = window.normalizeText(u.nombre).includes(searchText);
            const matchU = window.normalizeText(u.usuario).includes(searchText);
            const matchMuni = window.normalizeText(u.municipio).includes(searchText);
            if (!matchN && !matchU && !matchMuni) return false;
        }
        if (roleFilter === '_nacional') {
            const esNacional = u.rol === 'admin' || u.rol.startsWith('secretario_') || u.rol.startsWith('titular_');
            if (!esNacional) return false;
        } else if (roleFilter !== 'all' && roleFilter && u.rol !== roleFilter) {
            return false;
        }
        if (stateFilter && stateFilter !== "" && u.estado !== stateFilter) return false;
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No hay resultados.</td></tr>';
        return;
    }

    const currentUser = window.CRM.currentUser;
    const canEditGlobal = window.hasPermission('edit_users');
    const canDelete = window.hasPermission('delete_items');

    tbody.innerHTML = filtered.map(u => {
        let displayRole = ROLE_NAMES[u.rol] || u.rol;
        if (overrides[u.rol]?.label) displayRole = overrides[u.rol].label;
        
        let detalle = u.municipio || '-';
        if (u.rol.includes('distrital')) detalle = `Dtto. ${u.distrito || '?'}`;
        
        let canEditThisUser = false;
        if (canEditGlobal) {
            if (ROLES_NACIONALES_FULL.includes(currentUser.rol)) {
                canEditThisUser = true;
            } else if (u.estado === currentUser.estado) {
                canEditThisUser = true; 
            }
        }
        if (u.usuario === currentUser.usuario) canEditThisUser = true; 

        const btnEdit = canEditThisUser ? `<button class="secondary-btn small-btn" onclick="window.editUser('${u.usuario}')" title="Editar">✏️</button>` : '';
        const _nomEsc = (u.nombre || u.usuario).replace(/'/g, "\\'");
        const btnDeleteHtml = canDelete
            ? `<button class="secondary-btn small-btn" style="background:#d32f2f;color:white;margin-left:5px;" onclick="window.confirmDeleteUser('${u.usuario}')" title="Eliminar">🗑️</button>`
            : (canEditThisUser && u.usuario !== currentUser.usuario
                ? `<button class="secondary-btn small-btn" style="background:#e65100;color:white;margin-left:5px;font-size:10px;" onclick="window.solicitarBorrado('usuario','${u.usuario}','${_nomEsc}')" title="Solicitar borrado al Alto Mando">📤 Solicitar Borrado</button>`
                : '');
        const btnCred = `<button class="secondary-btn small-btn" onclick="window.generateUserCredential('${u.usuario}')" title="Credencial">🪪</button>`;
        const waBtn = u.whatsapp ? `<a href="https://wa.me/${u.whatsapp}" target="_blank" style="text-decoration:none;">💬</a>` : '-';

        return `<tr>
            <td><div style="display:flex; align-items:center; gap:10px;">
                <img src="${u.foto || 'img/default-avatar.png'}" style="width:30px; height:30px; border-radius:50%; object-fit:cover;">
                <div><strong>${window.toTitleCase(u.nombre)}</strong><br><small style="color:#666;">${displayRole}</small></div>
            </div></td>
            <td>${u.estado}</td><td><small>${detalle}</small></td>
            <td style="color:#0d47a1; font-weight:bold;">${u.usuario}</td>
            <td style="text-align:center;">${waBtn}</td>
            <td>${btnCred} ${btnEdit} ${btnDeleteHtml}</td>
        </tr>`;
    }).join('');
};

// ==========================================
// 3. CREACIÓN Y EDICIÓN DE USUARIOS
// ==========================================

window.populateStatesSelect = function() {
    const select = document.getElementById('u_estado');
    if(!select) return;
    select.innerHTML = '<option value="">Selecciona Estado</option>';
    
    if (window.hasPermission('view_all_users')) {
        select.innerHTML += '<option value="Nacional">Nacional (Corporativo)</option>';
        ESTADOS_MX_ADMIN.forEach(e => select.innerHTML += `<option value="${e}">${e}</option>`);
        select.disabled = false;
    } else {
        const myState = window.CRM.currentUser.estado;
        select.innerHTML += `<option value="${myState}" selected>${myState}</option>`;
        select.disabled = true;
    }

    if(window.popularMunicipios) {
        select.onchange = function() { 
            window.popularMunicipios(this.value, 'u_municipio'); 
        };
        setTimeout(() => {
            if(select.value && select.value !== "Nacional") {
                window.popularMunicipios(select.value, 'u_municipio');
            }
        }, 100);
    }
};

window.populateRolesSelect = function() {
    const select = document.getElementById('u_rol');
    if(!select) return;
    
    select.innerHTML = '<option value="">Selecciona Rol</option>';
    
    const overrides = window.CRM.APP.trafficRules?.roleOverrides || {};
    
    const currentUser = window.CRM.currentUser;
    const isNationalAuth = ROLES_NACIONALES_FULL.includes(currentUser.rol);
    // Si no es nacional, filtrar al subconjunto que su rol puede realmente asignar
    const assignableRoles = isNationalAuth ? null : (ROLES_ASIGNABLES_POR_ROL[currentUser.rol] || []);

    CORE_ROLES_IDS.forEach(r => {
        if(r === 'admin') return; // admin nunca aparece en el selector
        if(r === 'validacion' && !isNationalAuth) return; // solo nacionales asignan validacion
        // Si no es nacional: mostrar solo los roles que su tier puede asignar
        if (!isNationalAuth && !assignableRoles.includes(r)) return;

        const label = overrides[r]?.label || ROLE_NAMES[r];
        select.innerHTML += `<option value="${r}">${label}</option>`;
    });

    const customRoles = window.CRM.APP.customRoles || [];
    customRoles.forEach(r => {
        // Nacionales ven todos los roles custom; no nacionales solo ven los de su lista
        if (!isNationalAuth && !assignableRoles.includes(r.value)) return;

        const label = overrides[r.value]?.label || r.label;
        select.innerHTML += `<option value="${r.value}">${r.icon || '👤'} ${label}</option>`;
    });

    select.onchange = function() {
        const val = this.value;
        const show = id => document.getElementById(id).style.display = 'block';
        const hide = id => document.getElementById(id).style.display = 'none';

        hide('u_municipio_container'); hide('u_distrito_container'); hide('u_circunscripcion_container');
        
        if(val === 'secretario_municipal' || val === 'regidor' || val === 'sindico') show('u_municipio_container');
        if(val.includes('distrital') || val.includes('diputado')) show('u_distrito_container');
        if(val.includes('circunscripcion')) show('u_circunscripcion_container');
        document.getElementById('u_invita_container').style.display = 'block';
    };
};

window.handleUserFormSubmit = async function(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = "Guardando...";

    try {
        const id = document.getElementById('u_id').value; 
        const isEdit = !!id;
        
        const estadoFinal = window.hasPermission('view_all_users') ? 
                            document.getElementById('u_estado').value : 
                            window.CRM.currentUser.estado;

        // 🔥 PROTECCIÓN LÓGICA DEL PASAPORTE MULTIESTATAL 🔥
        const isNationalAuth = ROLES_NACIONALES_FULL.includes(window.CRM.currentUser.rol);
        const multiEl = document.getElementById('u_multiestatal');
        // Solo respetamos el valor de la casilla si el usuario actual es Admin
        const pasaporteValidado = (isNationalAuth && multiEl) ? multiEl.checked : false;

        const newUser = {
            id: id, 
            usuario: document.getElementById('u_usuario').value.trim(),
            password: document.getElementById('u_password').value.trim(),
            nombre: document.getElementById('u_nombre').value.toUpperCase(),
            rol: document.getElementById('u_rol').value,
            estado: estadoFinal,
            whatsapp: document.getElementById('u_whatsapp').value.trim(),
            municipio: document.getElementById('u_municipio').value.trim(),
            distrito: document.getElementById('u_distrito').value.trim(),
            circunscripcion: document.getElementById('u_circunscripcion').value,
            invita: document.getElementById('u_invita')?.value.trim(),
            multiestatal: pasaporteValidado
        };

        if(!newUser.usuario || !newUser.nombre || !newUser.rol || !newUser.estado) throw new Error("Datos incompletos.");
        if(!isEdit && !newUser.password) throw new Error("Contraseña requerida para nuevos usuarios.");

        const file = document.getElementById('u_foto').files[0];
        if(file && window.fileToBase64) newUser.foto = await window.fileToBase64(file);
        else if (isEdit && window.CRM.editingUser) newUser.foto = window.CRM.editingUser.foto;

        if(typeof window.saveUserToCloud === 'function') {
            await window.saveUserToCloud(newUser, isEdit);
            alert(isEdit ? "Actualizado." : "Creado.");
            window.closeModal('modalCreateUser');
            window.location.reload(); 
        } else throw new Error("API Offline");

    } catch (err) {
        if (err.message !== 'CANCELADO') alert("Error: " + err.message);
    } finally { btn.disabled = false; btn.textContent = "Guardar Usuario"; }
};

window.editUser = function(username) {
    const user = window.CRM.APP.users.find(u => u.usuario === username);
    if(!user) return;

    window.populateStatesSelect();
    window.populateRolesSelect();
    window.CRM.editingUser = user;

    document.getElementById('u_id').value = user.usuario; 

    // 🔥 PROTECCIÓN VISUAL DEL PASAPORTE MULTIESTATAL 🔥
    const multiEl = document.getElementById('u_multiestatal');
    const isNationalAuth = ROLES_NACIONALES_FULL.includes(window.CRM.currentUser.rol);
    
    if (multiEl) {
        multiEl.checked = user.multiestatal === true;
        // Ocultamos todo el contenedor div si no es Admin
        multiEl.parentElement.parentElement.style.display = isNationalAuth ? 'block' : 'none';
    }

    document.getElementById('u_usuario').value = user.usuario;
    document.getElementById('u_usuario').setAttribute('readonly', 'true');
    document.getElementById('u_nombre').value = user.nombre;
    
    const passInput = document.getElementById('u_password');
    passInput.value = '';
    passInput.placeholder = 'Dejar en blanco para no cambiarla';
    passInput.removeAttribute('required');
    passInput.type = 'password';
    // Ocultar display de contraseña temporal al abrir edición
    const _tdisp = document.getElementById('password-temp-display');
    if (_tdisp) _tdisp.style.display = 'none';

    document.getElementById('u_rol').value = user.rol;
    
    if(window.hasPermission('view_all_users')) {
        document.getElementById('u_estado').value = user.estado;
    }
    
    if (window.popularMunicipios && user.estado && user.estado !== "Nacional") {
        window.popularMunicipios(user.estado, 'u_municipio');
    }
    
    document.getElementById('u_whatsapp').value = user.whatsapp || '';
    document.getElementById('u_distrito').value = user.distrito || '';
    if(user.invita) document.getElementById('u_invita').value = user.invita;
    
    setTimeout(() => {
        if(user.municipio) document.getElementById('u_municipio').value = user.municipio;
    }, 150);
    
    const rolSelect = document.getElementById('u_rol');
    if(rolSelect.onchange) rolSelect.onchange();

    const img = document.getElementById('u_foto_preview');
    if(user.foto) { img.src = user.foto; img.style.display = 'block'; } 
    else { img.style.display = 'none'; }

    if(passInput) {
        let eye = passInput.parentElement.querySelector('.toggle-eye');
        if (!passInput.parentElement.classList.contains('password-container')) {
            const wrapper = document.createElement('div');
            wrapper.className = 'password-container';
            passInput.parentNode.insertBefore(wrapper, passInput);
            wrapper.appendChild(passInput);
            
            eye = document.createElement('i');
            eye.className = 'toggle-eye';
            wrapper.appendChild(eye);
        }
        if (eye) {
            eye.textContent = '🙈'; 
            eye.onclick = function() { 
                if (passInput.type === 'password') {
                    passInput.type = 'text';
                    this.textContent = '🙈';
                } else {
                    passInput.type = 'password';
                    this.textContent = '👁️';
                }
            };
        }
    }

    document.querySelector('#modalCreateUser h3').textContent = "✏️ Editar Coordinador";
    window.openModal('modalCreateUser');
};

// ======================================================
// GENERADOR DE CONTRASEÑA TEMPORAL
// ======================================================
window.generarPasswordTemporal = function() {
    const palabras = [
        'Aguila','Bosque','Cielo','Delfin','Estrella','Fuente','Jardin','Lago',
        'Monte','Nube','Palma','Pinar','Roca','Sierra','Sol','Valle','Viento',
        'Cedro','Flores','Mangle','Llano','Meseta','Selva','Bahia','Canion'
    ];
    const p1 = palabras[Math.floor(Math.random() * palabras.length)];
    const p2 = palabras[Math.floor(Math.random() * palabras.length)];
    const n1 = Math.floor(Math.random() * 90) + 10; // 10–99
    const n2 = Math.floor(Math.random() * 90) + 10; // 10–99
    const pwd = `${p1}${n1}${p2}${n2}`;            // Ej: "Aguila47Bosque23"

    // Poner en el input y mostrarlo en texto claro
    const input = document.getElementById('u_password');
    if (input) {
        input.value = pwd;
        input.type = 'text';
        const eye = input.parentElement.querySelector('.toggle-eye');
        if (eye) eye.textContent = '🙈';
    }

    // Mostrar panel verde con la contraseña
    const display = document.getElementById('password-temp-display');
    const textEl  = document.getElementById('password-temp-text');
    if (display && textEl) {
        textEl.textContent = pwd;
        display.style.display = 'block';
        // Restablecer botón copiar
        const copyBtn = display.querySelector('button');
        if (copyBtn) copyBtn.textContent = '📋 Copiar al Portapapeles';
    }
};

window.copiarPasswordTemporal = function(btn) {
    const pwd = document.getElementById('password-temp-text')?.textContent?.trim();
    if (!pwd) return;

    const done = () => {
        if (btn) {
            btn.textContent = '✅ ¡Copiado!';
            setTimeout(() => { btn.textContent = '📋 Copiar al Portapapeles'; }, 2500);
        }
    };

    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(pwd).then(done).catch(() => {
            // Fallback para navegadores sin permisos clipboard
            const inp = document.getElementById('u_password');
            if (inp) { inp.select(); document.execCommand('copy'); }
            done();
        });
    } else {
        const inp = document.getElementById('u_password');
        if (inp) { inp.select(); document.execCommand('copy'); }
        done();
    }
};

// Escuchamos el botón de crear usuario para resetear los permisos visuales
document.addEventListener('DOMContentLoaded', () => {
    const btnCreate = document.getElementById('btnCreateUser');
    if (btnCreate) {
        const oldClick = btnCreate.onclick;
        btnCreate.onclick = function(e) {
            const passInput = document.getElementById('u_password');
            if(passInput) {
                passInput.setAttribute('required', 'true');
                passInput.placeholder = 'Contraseña obligatoria';
                passInput.value = '';
            }
            const userInput = document.getElementById('u_usuario');
            if(userInput) {
                userInput.removeAttribute('readonly');
                userInput.value = '';
            }
            document.getElementById('u_id').value = '';
            const titulo = document.querySelector('#modalCreateUser h3');
            if(titulo) titulo.textContent = '👤 Crear Nuevo Coordinador';
            
            // 🔥 Reset y ocultamiento del Pasaporte Multiestatal
            if (window.CRM && window.CRM.currentUser) {
                const isNationalAuth = ROLES_NACIONALES_FULL.includes(window.CRM.currentUser.rol);
                const multiEl = document.getElementById('u_multiestatal');
                if (multiEl) {
                    multiEl.checked = false;
                    multiEl.parentElement.parentElement.style.display = isNationalAuth ? 'block' : 'none';
                }
            }
            
            if(oldClick) oldClick(e);
        };
    }
});

window.confirmDeleteUser = async function(username) {
    if(!confirm(`¿Eliminar a ${username}? Esta acción no se puede deshacer.`)) return;
    try {
        await window.deleteUserFromCloud(username);
        alert("Eliminado.");
        window.CRM.APP.users = window.CRM.APP.users.filter(u => u.usuario !== username);
        window.applyUserListFilters();
        window.updateStats();
    } catch(e) { alert(e.message); }
};

window.generateUserCredential = function(username) {
    if(!window.generateCredentialImage) return alert("Motor de PDF cargando...");
    const user = window.CRM.APP.users.find(u => u.usuario === username);
    
    if (!user.foto || user.foto.length < 100) {
        if (confirm(`⚠️ ${user.nombre} no tiene foto.\n\n¿Deseas subir una ahora?`)) {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    alert("⏳ Procesando...");
                    user.foto = await window.fileToBase64(file);
                    await window.saveUserToCloud(user, true);
                    alert("✅ Foto guardada.");
                    window.generateUserCredential(username);
                } catch(err) { alert("Error: " + err); }
            };
            input.click();
            return;
        }
    }

    const overrides = window.CRM.APP.trafficRules?.roleOverrides || {};
    let displayRole = overrides[user.rol]?.label || ROLE_NAMES[user.rol] || user.rol;

    window.generateCredentialImage({
        nombre: user.nombre, rol: displayRole, estado: user.estado, municipio: user.municipio,
        circulo: "ESTRUCTURA DIRECTIVA", id: `EST-${user.id || '00'}`, foto: user.foto
    });
};

// ==============================================================
// 🔥 NUEVO: MÓDULO DE ANALÍTICA Y RENDIMIENTO (HEATMAP Y RADAR) 🔥
// ==============================================================

window.abrirAnaliticaServidor = function() {
    if (!ROLES_NACIONALES_FULL.includes(window.CRM.currentUser.rol)) return alert("Acceso denegado.");

    let modal = document.getElementById('modalAnalitica');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modalAnalitica';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content modal-content-large" style="max-width: 95vw; width: 1000px; border-top: 5px solid #17a2b8;">
                <span class="close" onclick="closeModal('modalAnalitica')">×</span>
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid #17a2b8; padding-bottom: 10px; margin-bottom:20px;">
                    <h2 style="color: #17a2b8; margin:0;">📈 Diagnóstico y Rendimiento del Servidor</h2>
                    <button class="primary-btn" onclick="window.handleExportAnaliticaPDF()" style="background:#17a2b8; border:none; margin:0;">📄 Exportar a PDF Ejecutivo</button>
                </div>
                <div id="analitica-content">
                    <p style="text-align:center;">Procesando miles de registros. Por favor espera...</p>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    const { circles, users } = window.getAccessibleData ? window.getAccessibleData() : { circles: window.CRM.APP.circles, users: window.CRM.APP.users };

    // --- 1. PROCESAMIENTO: Termómetro de Saturación (Heatmap) ---
    const heatmap = Array(7).fill(0).map(() => Array(24).fill(0));
    let maxIntensity = 0;
    
    circles.forEach(c => {
        // Usar timestamp real si existe, sino simular con la fecha a mediodía
        const dStr = c.timestamp || (c.acta.fecha ? c.acta.fecha + 'T12:00:00' : null);
        if(dStr) {
            const d = new Date(dStr);
            if(!isNaN(d)) {
                const day = d.getDay(); // 0=Dom, 1=Lun...
                const hr = d.getHours(); // 0-23
                heatmap[day][hr]++;
                if(heatmap[day][hr] > maxIntensity) maxIntensity = heatmap[day][hr];
            }
        }
    });

    const daysName = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    
    let htmlHeatmap = `<h4 style="color:#d32f2f; margin-bottom:5px;">🔥 Mapa de Calor: Saturación de Servidor (Círculos Creados por Hora)</h4>`;
    htmlHeatmap += `<p class="small" style="margin-top:0;">Permite identificar las horas críticas donde el servidor se asfixia por alta concurrencia de envío de actas con fotos.</p>`;
    htmlHeatmap += `<div style="overflow-x:auto; margin-bottom:30px;"><table style="width:100%; border-collapse:collapse; font-size:11px; text-align:center;">`;
    
    // Cabecera Horas
    htmlHeatmap += `<tr><th style="padding:5px; border:1px solid #ddd; background:#f4f7f6; text-align:left;">Día \\ Hora</th>`;
    for(let h=0; h<24; h++) htmlHeatmap += `<th style="padding:5px; border:1px solid #ddd; background:#f4f7f6;">${h}h</th>`;
    htmlHeatmap += `</tr>`;

    for(let d=0; d<7; d++) {
        htmlHeatmap += `<tr><th style="padding:5px; border:1px solid #ddd; background:#f4f7f6; text-align:left;">${daysName[d]}</th>`;
        for(let h=0; h<24; h++) {
            let val = heatmap[d][h];
            let bgColor = '#fff';
            let color = '#000';
            
            if (val > 0) {
                // Cálculo simple de calor: 0 (blanco) a maxIntensity (rojo fuerte)
                const ratio = val / (maxIntensity || 1);
                // Si ratio es bajo, amarillo. Si es alto, naranja/rojo.
                if(ratio < 0.2) { bgColor = '#ffe0b2'; }
                else if(ratio < 0.5) { bgColor = '#ffb74d'; }
                else if(ratio < 0.8) { bgColor = '#ff9800'; color = '#fff'; fontStyle = 'bold'; }
                else { bgColor = '#e65100'; color = '#fff'; fontStyle = 'bold'; }
            } else {
                val = '';
            }
            
            htmlHeatmap += `<td style="padding:5px; border:1px solid #ddd; background-color:${bgColor}; color:${color}; font-weight:${val!=='' ? 'bold' : 'normal'};">${val}</td>`;
        }
        htmlHeatmap += `</tr>`;
    }
    htmlHeatmap += `</table></div>`;

    // --- 2. PROCESAMIENTO: Radar de Simuladores (Guerreros vs Fantasmas) ---
    const now = new Date();
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(now.getDate() - 30);
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(now.getDate() - 7);

    const performance = users.map(u => {
        const misC = circles.filter(c => c.coordinador_usuario === u.usuario);
        const recientes30 = misC.filter(c => {
            const d = new Date(c.timestamp || c.acta.fecha + 'T12:00:00');
            return d >= thirtyDaysAgo;
        }).length;
        
        let lastConn = new Date(0);
        if (u.ultima_conexion && u.ultima_conexion !== '0000-00-00 00:00:00') {
            lastConn = new Date(u.ultima_conexion.replace(' ', 'T'));
        }
        
        let tag = '';
        let colorObj = {};
        
        // Lógica dura
        if (lastConn >= sevenDaysAgo && recientes30 > 0) {
            tag = '🟢 Guerrero (Activo y Produce)';
            colorObj = { bg: '#d4edda', text: '#155724' };
        } else if (lastConn >= sevenDaysAgo && recientes30 === 0) {
            tag = '🟡 Simulador (Entra al CRM pero 0 círculos)';
            colorObj = { bg: '#fff3cd', text: '#856404' };
        } else if (lastConn < sevenDaysAgo && recientes30 === 0) {
            tag = '🔴 Fantasma (Ni entra ni produce)';
            colorObj = { bg: '#f8d7da', text: '#721c24' };
        } else {
            tag = '🔵 En Pausa (Produjo pero lleva días sin entrar)';
            colorObj = { bg: '#cce5ff', text: '#004085' };
        }
        
        let formatConn = 'Nunca / Desconocida';
        if (lastConn.getTime() > 0) formatConn = lastConn.toLocaleString('es-MX', {dateStyle:'short', timeStyle:'short'});
        
        return { 
            nombre: u.nombre, estado: u.estado, 
            total: misC.length, recientes30, 
            lastConnStr: formatConn, tag, colorObj 
        };
    }).sort((a, b) => b.total - a.total);

    let htmlRadar = `<h4 style="color:#0d47a1; margin-bottom:5px;">📡 Radar de Operadores (Eficiencia Real)</h4>`;
    htmlRadar += `<p class="small" style="margin-top:0;">Cruza la última vez que abrieron el sistema vs la cantidad de actas reales subidas en el último mes.</p>`;
    
    htmlRadar += `<div style="max-height: 400px; overflow-y: auto; border: 1px solid #ddd; border-radius: 8px;">
        <table class="report-table" style="width: 100%; text-align: left; border-collapse: collapse; font-size: 12px;">
            <thead style="position: sticky; top: 0; background: #333; color: white;">
                <tr>
                    <th style="padding: 8px;">Operador / Estado</th>
                    <th style="padding: 8px; text-align: center;">Última Conexión</th>
                    <th style="padding: 8px; text-align: center;">Círculos (Totales)</th>
                    <th style="padding: 8px; text-align: center;">Círculos (Últimos 30 Días)</th>
                    <th style="padding: 8px;">Diagnóstico del Sistema</th>
                </tr>
            </thead>
            <tbody>`;

    performance.forEach(p => {
        htmlRadar += `<tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 8px;"><strong>${window.toTitleCase(p.nombre)}</strong><br><small style="color:#666;">${p.estado}</small></td>
            <td style="padding: 8px; text-align: center;">${p.lastConnStr}</td>
            <td style="padding: 8px; text-align: center; font-weight: bold; font-size: 14px;">${p.total}</td>
            <td style="padding: 8px; text-align: center; font-weight: bold; color:#17a2b8;">+${p.recientes30}</td>
            <td style="padding: 8px; background-color: ${p.colorObj.bg}; color: ${p.colorObj.text}; font-weight: bold;">${p.tag}</td>
        </tr>`;
    });
    
    if(performance.length === 0) htmlRadar += `<tr><td colspan="5" style="text-align:center;">No hay operadores registrados.</td></tr>`;
    htmlRadar += `</tbody></table></div>`;

    document.getElementById('analitica-content').innerHTML = htmlHeatmap + htmlRadar;
    window.openModal('modalAnalitica');
};

// ==========================================
// 4. REPORTES Y MAPAS
// ==========================================

window.populateReportStates = function() {
    const select = document.getElementById('reporte_estado_select');
    if(!select) return;
    select.innerHTML = '<option value="">-- Selecciona --</option>';
    
    if (window.hasPermission('view_all_users')) {
        ESTADOS_MX_ADMIN.forEach(e => select.innerHTML += `<option value="${e}">${e}</option>`);
        select.disabled = false;
    } else {
        const myState = window.CRM.currentUser.estado;
        select.innerHTML += `<option value="${myState}" selected>${myState}</option>`;
        select.disabled = true;
    }
};

window.runStateReport = function() {
    const estado = document.getElementById('reporte_estado_select').value;
    if(!estado) return alert("Selecciona Estado");

    const municipioFiltro = (document.getElementById('reporte_municipio_select')?.value || '').toUpperCase();

    const circles = window.CRM.APP.circles.filter(c => {
        if (c.acta.estado !== estado) return false;
        if (municipioFiltro && (c.acta.municipio || '').toUpperCase() !== municipioFiltro) return false;
        return true;
    });
    const users = window.CRM.APP.users.filter(u => u.estado === estado);
    const secciones = new Set();
    circles.forEach(c => { if(c.cedulas) c.cedulas.forEach(m => { if(m.seccion) secciones.add(m.seccion.trim()); }); });

    let metaEstado = 0;
    if (window.CRM && window.CRM.SECCIONES_POR_ESTADO && window.CRM.SECCIONES_POR_ESTADO[estado]) {
        metaEstado = Math.ceil(window.CRM.SECCIONES_POR_ESTADO[estado] * 2.5);
    } else {
        metaEstado = 1000; 
    }
    
    const pct = metaEstado > 0 ? ((circles.length / metaEstado) * 100).toFixed(1) : 0;

    const overrides = window.CRM.APP.trafficRules?.roleOverrides || {};
    let rolesDictionary = { ...ROLE_NAMES };
    
    CORE_ROLES_IDS.forEach(r => {
        if(overrides[r]?.label) rolesDictionary[r] = overrides[r].label;
    });

    const customRoles = window.CRM.APP.customRoles || [];
    customRoles.forEach(r => {
        rolesDictionary[r.value] = `${r.icon || '👤'} ${overrides[r.value]?.label || r.label}`;
    });

    let roleCounts = {};
    let circlesAccountedFor = 0;

    users.forEach(u => {
        const roleId = u.rol;
        if(!roleCounts[roleId]) roleCounts[roleId] = 0;
        roleCounts[roleId]++;
        
        const misC = circles.filter(c => c.coordinador_usuario === u.usuario);
        circlesAccountedFor += misC.length;
    });

    const orphanCircles = circles.length - circlesAccountedFor;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let detalleUsuariosHTML = `<h4 style="margin-top: 20px; margin-bottom: 10px; color: #333;">🚦 Desglose General de Productividad (Ordenado por Total):</h4>
        <div style="max-height: 400px; overflow-y: auto; border: 1px solid #eee; border-radius: 8px;">
        <table class="report-table" style="width: 100%; text-align: left; border-collapse: collapse; font-size: 12px;">
            <thead style="position: sticky; top: 0; background: #f4f7f6;">
                <tr>
                    <th style="padding: 8px;">Nombre / Cargo</th>
                    <th style="padding: 8px;">Municipio</th>
                    <th style="padding: 8px; text-align: center;">Círculos</th>
                    <th style="padding: 8px; text-align: center;">Últimos 30 Días</th>
                    <th style="padding: 8px; text-align: center;">Integrantes</th>
                    <th style="padding: 8px; text-align: center;">Estatus</th>
                </tr>
            </thead>
            <tbody>`;

    const usersDesempeno = users.map(u => {
        const misC = circles.filter(c => c.coordinador_usuario === u.usuario);
        const recientes = misC.filter(c => {
            const dateString = c.acta.fecha || (c.timestamp ? c.timestamp.split('T')[0] : null);
            if(!dateString) return false;
            const f = new Date(dateString + 'T12:00:00');
            return f >= thirtyDaysAgo;
        }).length;
        const misInt = misC.reduce((acc, c) => acc + (c.cedulas ? c.cedulas.length : 0), 0);
        
        let color = '#dc3545';
        let bg = '#f8d7da';
        let textoStatus = '🔴 En Ceros';
        
        if (misC.length > 0 && recientes === 0) {
            color = '#856404'; 
            bg = '#fff3cd';
            textoStatus = '🟡 Estancado';
        } else if (recientes > 0) {
            color = '#155724'; 
            bg = '#d4edda';
            textoStatus = '🟢 Activo';
        }
        
        return { u, total: misC.length, recientes, misInt, color, bg, textoStatus };
    }).sort((a, b) => b.total - a.total); 

    usersDesempeno.forEach(item => {
        const roleName = rolesDictionary[item.u.rol] || window.toTitleCase(item.u.rol.replace(/_/g, ' '));
        detalleUsuariosHTML += `<tr style="background-color: ${item.bg}; border-bottom: 1px solid #fff;">
            <td style="padding: 8px;"><strong>${window.toTitleCase(item.u.nombre)}</strong><br><small style="color:#666;">${roleName}</small></td>
            <td style="padding: 8px;">${item.u.municipio || '-'}</td>
            <td style="padding: 8px; text-align: center; font-weight: bold;">${item.total}</td>
            <td style="padding: 8px; text-align: center; font-weight: bold;">+${item.recientes}</td>
            <td style="padding: 8px; text-align: center;">${item.misInt}</td>
            <td style="padding: 8px; text-align: center; color: ${item.color}; font-weight: bold;">${item.textoStatus}</td>
        </tr>`;
    });

    if(usersDesempeno.length === 0) {
        detalleUsuariosHTML += `<tr><td colspan="6" style="text-align:center; padding: 15px;">No hay estructura en este estado.</td></tr>`;
    }
    detalleUsuariosHTML += `</tbody></table></div>`;

    let orphanAlert = "";
    if (orphanCircles > 0) {
        orphanAlert = `
        <div style="background: #fff3cd; border: 1px solid #ffeeba; color: #856404; padding: 10px; border-radius: 6px; margin-top: 15px; font-size: 13px;">
            ⚠️ <strong>Auditoría de Círculos:</strong> Hay <strong>${orphanCircles} Círculos</strong> registrados en ${estado} que no pertenecen a la estructura local actual. Fueron creados por la Coordinación Nacional o por usuarios que ya fueron eliminados del sistema.
        </div>`;
    }

    let barraHTML = `
        <div style="margin-bottom: 20px; background: #fff; border: 1px solid #ddd; padding: 15px; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px; align-items: center;">
                <strong style="color: #333; font-size: 14px;">🚀 Avance de Meta 2027 (${estado})</strong>
                <span style="font-weight: bold; color: #fff; background: #ff7e00; padding: 3px 8px; border-radius: 12px; font-size: 12px;">${pct}%</span>
            </div>
            <div style="background: #eee; border-radius: 10px; height: 18px; overflow: hidden; position: relative; margin-bottom: 8px;">
                <div style="background: #28a745; height: 100%; width: ${Math.min(pct, 100)}%; transition: width 0.5s;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; color: #666;">
                <span>Círculos Validados: <strong>${circles.length}</strong></span>
                <span>Meta Estatal: <strong>${metaEstado}</strong></span>
            </div>
        </div>
    `;

    const html = `
        <h3 style="border-bottom: 2px solid #ff7e00; padding-bottom: 5px;">📍 Reporte: ${estado}</h3>
        ${barraHTML}
        <div style="display:flex; justify-content: space-between; background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
            <div style="flex: 1;">
                <span style="font-size: 26px; font-weight:bold; color:#ff7e00;">${circles.length}</span><br>
                <small style="color:#666; font-weight:bold;">CÍRCULOS TOTALES</small>
            </div>
            <div style="flex: 1; border-left: 1px solid #ddd; border-right: 1px solid #ddd;">
                <span style="font-size: 26px; font-weight:bold; color:#0d47a1;">${users.length}</span><br>
                <small style="color:#666; font-weight:bold;">ESTRUCTURA</small>
            </div>
            <div style="flex: 1;">
                <span style="font-size: 26px; font-weight:bold; color:#28a745;">${secciones.size}</span><br>
                <small style="color:#666; font-weight:bold;">SECCIONES CUBIERTAS</small>
            </div>
        </div>
        ${detalleUsuariosHTML}
        ${orphanAlert}
    `;
    
    document.getElementById('reporteEstadosContent').innerHTML = html;
    document.getElementById('btnExportarReportePDF').disabled = false;
};

// ==============================================================
// 🔥 MEGA-REPORTE NACIONAL Y RANKINGS GAMIFICADOS 🔥
// ==============================================================
window.runCircunscripcionReport = function() {
    const mapCirc = { 
        "1ª (Noroeste)": ["Baja California", "Baja California Sur", "Chihuahua", "Durango", "Jalisco", "Nayarit", "Sinaloa", "Sonora"], 
        "2ª (Noreste)": ["Aguascalientes", "Coahuila", "Guanajuato", "Nuevo León", "Querétaro", "San Luis Potosí", "Tamaulipas", "Zacatecas"], 
        "3ª (Sureste)": ["Campeche", "Chiapas", "Oaxaca", "Quintana Roo", "Tabasco", "Veracruz", "Yucatán"], 
        "4ª (Centro-Sur)": ["Ciudad de México", "Guerrero", "Morelos", "Puebla", "Tlaxcala"], 
        "5ª (Occidente)": ["Colima", "Estado de México", "Hidalgo", "Michoacán"] 
    };

    const { circles, users } = window.getAccessibleData ? window.getAccessibleData() : { circles: window.CRM.APP.circles, users: window.CRM.APP.users };
    
    let html = '';

    // ----------------------------------------------------
    // 1. RANKING NACIONAL DE ESTADOS (BARRAS VISUALES)
    // ----------------------------------------------------
    html += `<h4 style="color:#ff7e00; margin-bottom:15px; border-bottom: 2px solid #ff7e00; padding-bottom:5px;">🇲🇽 Ranking de Productividad por Estado</h4>`;
    html += `<div style="max-height: 250px; overflow-y: auto; background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 25px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.05);">`;
    
    const stateRanking = ESTADOS_MX_ADMIN.map(est => {
        const cCount = circles.filter(c => c.acta.estado === est).length;
        const meta = window.CRM.SECCIONES_POR_ESTADO && window.CRM.SECCIONES_POR_ESTADO[est] ? Math.ceil(window.CRM.SECCIONES_POR_ESTADO[est] * 2.5) : 1000;
        return { estado: est, total: cCount, meta: meta, pct: (cCount / meta) * 100 };
    }).filter(s => s.total > 0).sort((a, b) => b.total - a.total);

    stateRanking.forEach((s, idx) => {
        const pctFill = Math.min(s.pct, 100).toFixed(1);
        const colorBarra = idx === 0 ? '#ffc107' : (idx === 1 ? '#adb5bd' : (idx === 2 ? '#cd7f32' : '#28a745'));
        
        html += `
            <div style="display:flex; align-items:center; margin-bottom: 8px;">
                <div style="width: 25px; font-weight: bold; color: #666; font-size: 11px;">#${idx+1}</div>
                <div style="width: 130px; font-size: 12px; font-weight: bold; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${s.estado}</div>
                <div style="flex: 1; background: #eee; height: 16px; border-radius: 8px; overflow: hidden; margin: 0 10px; border: 1px solid #ddd;">
                    <div style="width: ${pctFill}%; background: ${colorBarra}; height: 100%; transition: width 0.5s;"></div>
                </div>
                <div style="width: 60px; text-align: right; font-weight: bold; color: #ff7e00; font-size: 13px;">${s.total}</div>
            </div>
        `;
    });
    
    if(stateRanking.length === 0) html += `<p style="text-align:center; color:#999; margin:0;">No hay círculos registrados aún.</p>`;
    html += `</div>`;

    // ----------------------------------------------------
    // 2. PODIO Y RANKING GENERAL DE LÍDERES
    // ----------------------------------------------------
    const userRanking = users.map(u => {
        const misC = circles.filter(c => c.coordinador_usuario === u.usuario);
        const misI = misC.reduce((acc, c) => acc + (c.cedulas ? c.cedulas.length : 0), 0);
        let miCircunscripcion = "N/A";
        Object.entries(mapCirc).forEach(([cName, estados]) => { if(estados.includes(u.estado)) miCircunscripcion = cName; });
        return { nombre: u.nombre, estado: u.estado, region: miCircunscripcion, total: misC.length, integrantes: misI };
    }).filter(u => u.total > 0).sort((a, b) => b.total - a.total); 

    html += `<h4 style="color:#0d47a1; margin-bottom:15px; border-bottom: 2px solid #0d47a1; padding-bottom:5px;">🏆 Ranking General de Líderes</h4>`;
    
    if (userRanking.length > 0) {
        html += `<div style="display:flex; align-items:flex-end; justify-content:center; gap:15px; margin-bottom:25px; height: 180px;">`;
        if (userRanking[1]) {
            html += `<div style="flex:1; max-width: 150px; background:linear-gradient(135deg, #f5f7fa, #c3cfe2); padding:10px; border-radius:10px 10px 0 0; box-shadow:0 4px 6px rgba(0,0,0,0.1); border:2px solid #b0bec5; border-bottom:none; text-align:center; height: 130px; display:flex; flex-direction:column; justify-content:flex-end;">
                        <div style="font-size:30px; margin-bottom:5px; text-shadow: 1px 1px 2px rgba(0,0,0,0.2);">🥈</div>
                        <div style="font-size:11px; font-weight:bold; color:#333; line-height:1.1; margin-bottom:5px;">${window.toTitleCase(userRanking[1].nombre)}</div>
                        <div style="font-size:9px; background:#607d8b; color:#fff; padding:2px 4px; border-radius:4px; margin:0 auto 5px auto; width:fit-content;">${userRanking[1].estado}</div>
                        <div style="font-size:16px; font-weight:bold; color:#37474f;">${userRanking[1].total}</div>
                     </div>`;
        }
        if (userRanking[0]) {
            html += `<div style="flex:1.2; max-width: 170px; background:linear-gradient(135deg, #fff9c4, #fbc02d); padding:15px; border-radius:10px 10px 0 0; box-shadow:0 -4px 10px rgba(251,192,45,0.4); border:2px solid #fbc02d; border-bottom:none; text-align:center; height: 160px; display:flex; flex-direction:column; justify-content:flex-end; position:relative; z-index:2;">
                        <div style="font-size:40px; margin-bottom:5px; text-shadow: 1px 1px 2px rgba(0,0,0,0.2);">🥇</div>
                        <div style="font-size:13px; font-weight:bold; color:#bf360c; line-height:1.1; margin-bottom:5px;">${window.toTitleCase(userRanking[0].nombre)}</div>
                        <div style="font-size:10px; background:#e65100; color:#fff; padding:3px 6px; border-radius:4px; margin:0 auto 5px auto; width:fit-content;">${userRanking[0].estado}</div>
                        <div style="font-size:22px; font-weight:bold; color:#e65100;">${userRanking[0].total}</div>
                     </div>`;
        }
        if (userRanking[2]) {
            html += `<div style="flex:1; max-width: 150px; background:linear-gradient(135deg, #efebe9, #bcaaa4); padding:10px; border-radius:10px 10px 0 0; box-shadow:0 4px 6px rgba(0,0,0,0.1); border:2px solid #a1887f; border-bottom:none; text-align:center; height: 110px; display:flex; flex-direction:column; justify-content:flex-end;">
                        <div style="font-size:25px; margin-bottom:5px; text-shadow: 1px 1px 2px rgba(0,0,0,0.2);">🥉</div>
                        <div style="font-size:11px; font-weight:bold; color:#3e2723; line-height:1.1; margin-bottom:5px;">${window.toTitleCase(userRanking[2].nombre)}</div>
                        <div style="font-size:9px; background:#5d4037; color:#fff; padding:2px 4px; border-radius:4px; margin:0 auto 5px auto; width:fit-content;">${userRanking[2].estado}</div>
                        <div style="font-size:16px; font-weight:bold; color:#3e2723;">${userRanking[2].total}</div>
                     </div>`;
        }
        html += `</div>`;
    }

    html += `<div style="max-height: 350px; overflow-y: auto; margin-bottom: 25px; border: 1px solid #ddd; border-radius: 8px;">
             <table class="report-table" style="width: 100%;">
             <thead style="position: sticky; top: 0; background: #333; color:#fff;">
                <tr><th style="width:40px;">Pos</th><th>Coordinador(a)</th><th>Estado / Región</th><th style="text-align:center;">Círculos</th><th style="text-align:center;">Integrantes</th></tr>
             </thead><tbody>`;
    userRanking.forEach((u, index) => {
        html += `<tr>
                    <td style="text-align:center; font-weight:bold; color:#666;">${index + 1}º</td>
                    <td><strong>${window.toTitleCase(u.nombre)}</strong></td>
                    <td><small>${u.estado}<br><span style="color:#888;">${u.region}</span></small></td>
                    <td style="text-align:center; font-size:14px; font-weight:bold; color:#0d47a1;">${u.total}</td>
                    <td style="text-align:center;">${u.integrantes}</td>
                 </tr>`;
    });
    if(userRanking.length === 0) html += `<tr><td colspan="5" style="text-align:center;">Nadie ha registrado círculos todavía.</td></tr>`;
    html += `</tbody></table></div>`;

    // 3. RESUMEN CLÁSICO
    html += `<h4 style="color:#28a745; margin-bottom:10px; border-bottom: 2px solid #28a745;">🌎 Resumen por Circunscripción</h4>
                <table class="report-table" style="margin-bottom: 25px;">
                <thead style="background:#28a745; color:white;"><tr><th>Circunscripción</th><th>Estados</th><th style="text-align:center;">Círculos</th><th style="text-align:center;">Integrantes</th><th style="text-align:center;">% Meta</th></tr></thead><tbody>`;
    let totalC = 0, totalI = 0;
    Object.entries(mapCirc).forEach(([circName, estados]) => {
        const circlesInCirc = circles.filter(c => estados.includes(c.acta.estado));
        const totalInt = circlesInCirc.reduce((sum, c) => sum + (c.cedulas ? c.cedulas.length : 0), 0);
        let metaCirc = 0; 
        estados.forEach(e => { if(window.CRM.SECCIONES_POR_ESTADO && window.CRM.SECCIONES_POR_ESTADO[e]) metaCirc += (window.CRM.SECCIONES_POR_ESTADO[e] * 2.5); });
        const pct = metaCirc > 0 ? ((circlesInCirc.length / metaCirc) * 100).toFixed(1) : 0;
        totalC += circlesInCirc.length;
        totalI += totalInt;
        html += `<tr><td style="text-align:center; font-weight:bold;">${circName}</td><td><small>${estados.join(', ')}</small></td>
                 <td style="text-align:center; font-weight:bold; color:#ff7e00;">${circlesInCirc.length}</td>
                 <td style="text-align:center;">${totalInt}</td><td style="text-align:center;">${pct}%</td></tr>`;
    });
    html += `<tr style="background:#eee; font-weight:bold;"><td colspan="2" style="text-align:right;">TOTAL NACIONAL:</td>
             <td style="text-align:center; color:#0d47a1; font-size:16px;">${totalC}</td><td style="text-align:center; font-size:16px;">${totalI}</td><td>-</td></tr></tbody></table>`;

    document.getElementById('reporteCircunscripcionesContent').innerHTML = html;
};

// ==========================================
// MÉTODOS DEL MAPA Y DEMÁS
// ==========================================
window.abrirMapaInteractivo = function() {
    window.openModal('modalMapa');
    window._setMapaTab('gps');
    setTimeout(() => {
        try {
        if (!window.map) {
            window.map = L.map('mapContainer').setView([23.6345, -102.5528], 5);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(window.map);
        } else {
            window.map.invalidateSize();
        }
        if(window.mapMarkers) window.map.removeLayer(window.mapMarkers);
        window.mapMarkers = L.layerGroup().addTo(window.map);
        } catch(initErr) {
            document.getElementById('mapContainer').innerHTML = '<p style="padding:20px;color:red;font-weight:bold;">ERROR MAPA: ' + initErr.message + '</p>';
            return;
        }
        
        const { circles } = window.getAccessibleData ? window.getAccessibleData() : { circles: [] };
        let pinCount = 0;

        circles.forEach((c, __idx) => {
            try {
            const lat = parseFloat(c.acta.lat);
            const lng = parseFloat(c.acta.lng);
            if(!isNaN(lat) && !isNaN(lng)) {
                pinCount++;
                let coordName = c.acta.coordinador || 'N/A';
                let coordPhone = c.acta.whatsapp || '';

                const designated = c.cedulas?.find(m => m.es_coordinador === true);
                if(designated) {
                    coordName = designated.nombre;
                    if (!coordPhone) coordPhone = designated.telefono;
                } else if (!coordPhone && c.cedulas && c.cedulas.length > 0) {
                    coordPhone = c.cedulas[0].telefono;
                }

                const cleanPhone = (coordPhone || '').replace(/\D/g, '');
                let phoneHtml = '<span style="color:#999; font-size:11px;"><i>Sin número</i></span>';
                let waButton = '';

                if (cleanPhone.length >= 10) {
                    const preMessage = encodeURIComponent(`Hola ${window.toTitleCase(coordName.split(' ')[0])}, te escribo desde la Coordinación de Círculos Ciudadanos.`);
                    const waLink = `https://wa.me/52${cleanPhone}?text=${preMessage}`;
                    
                    phoneHtml = `📞 <a href="tel:${cleanPhone}" style="color:#333; text-decoration:none;">${cleanPhone}</a>`;
                    waButton = `
                        <div style="margin-top: 10px; text-align: center;">
                            <a href="${waLink}" target="_blank" style="background-color: #25D366; color: white; padding: 6px 12px; border-radius: 4px; text-decoration: none; font-size: 12px; display: block; font-weight: bold; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                                💬 Enviar WhatsApp
                            </a>
                        </div>
                    `;
                }

                const intCount = c.cedulas ? c.cedulas.length : 0;

                const uid = c._db_uid || c.unique_id || '';

                // Buscar sección: primero en acta (nuevo), luego en cédulas del coordinador, luego primera cédula disponible
                let seccionVal = c.acta?.seccion || '';
                if (!seccionVal && c.cedulas?.length) {
                    const coord = c.cedulas.find(m => m.es_coordinador === true);
                    seccionVal = coord?.seccion || c.cedulas.find(m => m.seccion)?.seccion || '';
                }
                const seccionHtml = seccionVal
                    ? `<p style="margin: 3px 0; font-size: 12px;"><strong>🗳️ Secc:</strong> ${seccionVal}</p>`
                    : '';

                const popupContent = `
                    <div style="min-width: 200px; font-family: sans-serif;">
                        <h4 style="margin: 0 0 8px 0; color: #ff7e00; font-size: 14px; border-bottom: 1px solid #eee; padding-bottom: 5px;">
                            ${c.acta.nombre}
                        </h4>
                        <p style="margin: 3px 0; font-size: 12px;"><strong>📍 Mun:</strong> ${c.acta.municipio}</p>
                        ${seccionHtml}
                        <p style="margin: 3px 0; font-size: 12px;"><strong>👥 Int:</strong> ${intCount}</p>
                        <p style="margin: 3px 0; font-size: 12px;"><strong>👤 Coord:</strong> ${window.toTitleCase(coordName)}</p>
                        <p style="margin: 3px 0; font-size: 12px;">${phoneHtml}</p>
                        ${waButton}
                        <div style="margin-top: 10px; text-align: center;">
                            <button onclick="window.downloadCirclePDFFromMap('${uid}')" style="background:#1565c0; color:white; border:none; padding:6px 12px; border-radius:4px; font-size:12px; font-weight:bold; cursor:pointer; width:100%;">
                                📄 Descargar PDF del Acta
                            </button>
                        </div>
                    </div>
                `;

                L.circleMarker([lat, lng], { radius: 7, fillColor: '#ff7e00', color: '#fff', weight: 2, fillOpacity: 0.85 })
                 .bindPopup(popupContent)
                 .addTo(window.mapMarkers);
            }
            } catch(err) { console.error('Error en círculo #' + __idx, err, c); }
        });
        const _lbl = document.getElementById('mapa-stats-label');
        if (_lbl) _lbl.textContent = `${pinCount} círculos con GPS de ${circles.length} totales`;
    }, 500);
};

window.downloadCirclePDFFromMap = async function(uid) {
    if (!uid) { alert('Sin ID de círculo'); return; }
    try {
        const circle = await window.fetchCircleFullDetails(uid);
        if (window.generateCirclePDF) {
            window.generateCirclePDF(circle);
        } else {
            alert('Motor PDF cargando, intenta de nuevo.');
        }
    } catch(e) {
        alert('No se pudo obtener el acta: ' + e.message);
    }
};

// ==========================================
// 4b. MAPA TERRITORIAL — VISTAS CHOROPLETH (v15.19)
// ==========================================

window._geoJsonCache    = {};
window._choroplethLayer = null;
window._mapaLegenda     = null;
window._mapaVistaActual = 'gps';

// --- Actualiza estilos de los botones de vista ---
window._setMapaTab = function(vistaActiva) {
    ['gps', 'estados', 'municipios'].forEach(v => {
        const btn = document.getElementById('mapa-tab-' + v);
        if (!btn) return;
        if (v === vistaActiva) {
            btn.style.background = '#ff7e00';
            btn.style.color      = 'white';
            btn.style.border     = 'none';
        } else {
            btn.style.background = 'white';
            btn.style.color      = '#ff7e00';
            btn.style.border     = '2px solid #ff7e00';
        }
    });
    window._mapaVistaActual = vistaActiva;
};

// --- Controlador principal de vistas ---
window.switchMapaVista = function(vista) {
    if (!window.map) return;
    window._setMapaTab(vista);

    // Limpiar capa choropleth anterior
    if (window._choroplethLayer) {
        window.map.removeLayer(window._choroplethLayer);
        window._choroplethLayer = null;
    }
    // Limpiar leyenda anterior
    if (window._mapaLegenda) {
        window._mapaLegenda.remove();
        window._mapaLegenda = null;
    }

    if (vista === 'gps') {
        // Mostrar marcadores GPS guardados
        if (window.mapMarkers) window.mapMarkers.addTo(window.map);
        const { circles } = window.getAccessibleData ? window.getAccessibleData() : { circles: [] };
        const lbl = document.getElementById('mapa-stats-label');
        if (lbl) {
            const pinCount = window.mapMarkers ? window.mapMarkers.getLayers().length : 0;
            lbl.textContent = `${pinCount} círculos con GPS de ${circles.length} totales`;
        }
    } else {
        // Ocultar marcadores GPS (removeLayer + clearLayers como doble seguro)
        if (window.mapMarkers) {
            try { window.map.removeLayer(window.mapMarkers); } catch(_) {}
            try { window.mapMarkers.clearLayers(); }           catch(_) {}
        }
        if (vista === 'estados')    window._renderCapaEstados();
        else                        window._renderCapaMunicipios();
    }
};

// --- Normalización: nombre GeoJSON → nombre CRM ---
window._resolverEstadoGeo = function(nombreGeo) {
    const mapa = {
        'Coahuila de Zaragoza'           : 'Coahuila',
        'México'                          : 'Estado de México',
        'Michoacán de Ocampo'             : 'Michoacán',
        'Veracruz de Ignacio de la Llave' : 'Veracruz',
        'Querétaro de Arteaga'            : 'Querétaro',
        'Distrito Federal'               : 'Ciudad de México',
    };
    return mapa[nombreGeo] || nombreGeo;
};

// --- Escala de color MC orange proporcional a la densidad ---
window._colorPorConteo = function(count, max) {
    if (count === 0) return '#f0f0f0';
    const pct = count / max;
    if (pct > 0.75) return '#e65100';   // naranja profundo
    if (pct > 0.50) return '#f57c00';
    if (pct > 0.25) return '#fb8c00';
    if (pct > 0.10) return '#ffa726';
    return '#ffcc80';                   // naranja muy claro
};

// --- Leyenda Leaflet ---
window._agregarLeyendaMapa = function(max, conteo) {
    if (!window.map) return;
    const LeyendaCtrl = L.Control.extend({
        onAdd: function() {
            const div = L.DomUtil.create('div', '');
            div.style.cssText = 'background:white;padding:10px 12px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.25);font-size:12px;line-height:1.9;min-width:130px;pointer-events:none;';
            const zonas = Object.keys(conteo).length;
            div.innerHTML =
                '<strong style="display:block;margin-bottom:4px;font-size:13px;">Círculos</strong>' +
                [
                    ['#e65100', `> 75 % del máx.`],
                    ['#f57c00', `50 – 75 %`],
                    ['#fb8c00', `25 – 50 %`],
                    ['#ffa726', `10 – 25 %`],
                    ['#ffcc80', `1 – 10 %`],
                    ['#f0f0f0', 'Sin círculos'],
                ].map(([c, label]) =>
                    `<div style="display:flex;align-items:center;gap:6px;">` +
                    `<div style="width:14px;height:14px;background:${c};border:1px solid #ccc;border-radius:2px;flex-shrink:0;"></div>` +
                    `<span>${label}</span></div>`
                ).join('') +
                `<hr style="margin:6px 0;border:none;border-top:1px solid #eee;">` +
                `<small style="color:#888;">${zonas} zonas con actas</small>`;
            return div;
        }
    });
    window._mapaLegenda = new LeyendaCtrl({ position: 'bottomright' });
    window._mapaLegenda.addTo(window.map);
};

// --- Vista Choropleth: Por Estado ---
window._renderCapaEstados = async function() {
    const { circles } = window.getAccessibleData ? window.getAccessibleData() : { circles: [] };
    const lbl = document.getElementById('mapa-stats-label');
    if (lbl) lbl.textContent = 'Cargando mapa estatal…';

    // Contar círculos por estado (clave = nombre CRM)
    const conteo = {};
    circles.forEach(c => {
        const edo = (c.acta?.estado || '').trim();
        if (edo) conteo[edo] = (conteo[edo] || 0) + 1;
    });
    const maxCount = Math.max(...Object.values(conteo), 1);

    // Cargar GeoJSON — cascada de fuentes (caché → jsDelivr → GitHub raw → local)
    let geoData;
    if (window._geoJsonCache.estados) {
        geoData = window._geoJsonCache.estados;
    } else {
        const URLS_ESTADOS = [
            'https://cdn.jsdelivr.net/gh/angelnmara/geojson/mexicoHigh.json',
            'https://cdn.jsdelivr.net/gh/angelnmara/geojson@master/mexicoHigh.json',
            'https://raw.githubusercontent.com/angelnmara/geojson/master/mexicoHigh.json',
            'https://raw.githubusercontent.com/angelnmara/geojson/main/mexicoHigh.json',
            '/geojson/estados_mx.geojson'
        ];
        for (const url of URLS_ESTADOS) {
            try {
                const res = await fetch(url);
                if (!res.ok) continue;
                geoData = await res.json();
                if (geoData && geoData.features) {
                    window._geoJsonCache.estados = geoData;
                    break;
                }
            } catch (_e) { continue; }
        }
        if (!geoData) {
            if (lbl) lbl.textContent = '⚠️ No se pudo cargar el mapa de estados';
            return;
        }
    }

    if (lbl) lbl.textContent = `${circles.length} círculos en ${Object.keys(conteo).length} estados`;

    window._choroplethLayer = L.geoJSON(geoData, {
        style: function(feature) {
            const nomGeo  = feature.properties.name  || feature.properties.NAME  ||
                            feature.properties.ESTADO || feature.properties.NOM_ENT || '';
            const nomCRM  = window._resolverEstadoGeo(nomGeo);
            const count   = conteo[nomCRM] || 0;
            return {
                fillColor  : window._colorPorConteo(count, maxCount),
                weight     : 1.2,
                color      : '#ffffff',
                fillOpacity: count > 0 ? 0.82 : 0.25
            };
        },
        onEachFeature: function(feature, layer) {
            const nomGeo  = feature.properties.name  || feature.properties.NAME  ||
                            feature.properties.ESTADO || feature.properties.NOM_ENT || 'Estado';
            const nomCRM  = window._resolverEstadoGeo(nomGeo);
            const count   = conteo[nomCRM] || 0;
            layer.bindPopup(
                `<strong style="color:#e65100;">${nomGeo}</strong><br>` +
                `🟠 <b>${count}</b> círculo${count !== 1 ? 's' : ''}`
            );
            layer.on('mouseover', function() {
                this.setStyle({ weight: 3, color: '#ff7e00' });
                this.openPopup();
            });
            layer.on('mouseout', function() {
                if (window._choroplethLayer) window._choroplethLayer.resetStyle(this);
                this.closePopup();
            });
            layer.on('click', function() {
                // Zoom al estado y mostrar popup fijo
                window.map.fitBounds(this.getBounds(), { padding: [20, 20] });
            });
        }
    }).addTo(window.map);

    window._agregarLeyendaMapa(maxCount, conteo);
    window.map.fitBounds(window._choroplethLayer.getBounds(), { padding: [10, 10] });
};

// --- Vista Choropleth: Por Municipio ---
window._renderCapaMunicipios = async function() {
    const { circles } = window.getAccessibleData ? window.getAccessibleData() : { circles: [] };
    const lbl = document.getElementById('mapa-stats-label');
    if (lbl) lbl.textContent = 'Cargando mapa municipal…';

    // Contar círculos por Estado|Municipio
    const conteo = {};
    circles.forEach(c => {
        const edo = (c.acta?.estado    || '').trim();
        const mun = (c.acta?.municipio || '').trim();
        if (edo && mun) {
            const key = edo + '|' + mun;
            conteo[key] = (conteo[key] || 0) + 1;
        }
    });
    const maxCount = Math.max(...Object.values(conteo), 1);

    // Cargar GeoJSON municipal — cascada CDN → local
    let geoData;
    if (window._geoJsonCache.municipios) {
        geoData = window._geoJsonCache.municipios;
    } else {
        const URLS_MUNICIPIOS = [
            // jsDelivr (rama por defecto — más estable)
            'https://cdn.jsdelivr.net/gh/angelnmara/geojson/mexicoMunicipalidades.json',
            // GitHub raw, posibles nombres del archivo
            'https://raw.githubusercontent.com/angelnmara/geojson/master/mexicoMunicipalidades.json',
            'https://raw.githubusercontent.com/angelnmara/geojson/main/mexicoMunicipalidades.json',
            // Repo alternativo bien conocido
            'https://cdn.jsdelivr.net/gh/nicholasmfraser/mexico-geojson@main/data/municipalities.geojson',
            'https://raw.githubusercontent.com/nicholasmfraser/mexico-geojson/main/data/municipalities.geojson',
            // Fallback local (el usuario sube el archivo al servidor)
            '/geojson/municipios_mx.geojson'
        ];
        for (const url of URLS_MUNICIPIOS) {
            try {
                if (lbl) lbl.textContent = `Buscando mapa municipal…`;
                const res = await fetch(url);
                if (!res.ok) continue;
                const data = await res.json();
                if (data && data.features && data.features.length > 100) {
                    geoData = data;
                    window._geoJsonCache.municipios = geoData;
                    break;
                }
            } catch (_e) { continue; }
        }
    }

    if (!geoData) {
        if (lbl) lbl.textContent = '⚠️ Datos municipales no disponibles';
        const icon = L.divIcon({
            html: `<div style="background:white;padding:18px 22px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.2);font-size:13px;text-align:center;max-width:360px;line-height:1.7;">
                      <strong style="font-size:15px;display:block;margin-bottom:8px;">📂 Vista municipal no disponible</strong>
                      <span style="color:#555;">Para activarla, sube un archivo GeoJSON de municipios de México al servidor:<br>
                      <code style="background:#fff3e0;color:#e65100;padding:2px 8px;border-radius:4px;font-size:12px;display:inline-block;margin:6px 0;">/geojson/municipios_mx.geojson</code><br>
                      <small style="color:#888;">Fuente sugerida: Marco Geoestadístico INEGI<br>(marco-geoestadistico.inegi.org.mx)</small>
                      </span>
                   </div>`,
            iconSize : [360, 160],
            iconAnchor: [180, 80],
            className: ''
        });
        L.marker([23.6345, -102.5528], { icon }).addTo(window.map);
        return;
    }

    const totalMunicipios = Object.keys(conteo).length;
    if (lbl) lbl.textContent = `${circles.length} círculos en ${totalMunicipios} municipios`;

    window._choroplethLayer = L.geoJSON(geoData, {
        style: function(feature) {
            const nomEdoGeo = feature.properties.NOM_ENT    || feature.properties.ESTADO   || '';
            const nomMun    = feature.properties.NOM_MUN    || feature.properties.MUNICIPIO || '';
            const edoCRM    = window._resolverEstadoGeo(nomEdoGeo);
            const count     = conteo[edoCRM + '|' + nomMun] || 0;
            return {
                fillColor  : window._colorPorConteo(count, maxCount),
                weight     : 0.5,
                color      : '#aaa',
                fillOpacity: count > 0 ? 0.85 : 0.15
            };
        },
        onEachFeature: function(feature, layer) {
            const nomEdoGeo = feature.properties.NOM_ENT    || feature.properties.ESTADO   || '';
            const nomMun    = feature.properties.NOM_MUN    || feature.properties.MUNICIPIO || 'Municipio';
            const edoCRM    = window._resolverEstadoGeo(nomEdoGeo);
            const count     = conteo[edoCRM + '|' + nomMun] || 0;
            layer.bindPopup(
                `<strong style="color:#e65100;">${nomMun}</strong><br>` +
                `<small style="color:#888;">${nomEdoGeo}</small><br>` +
                `🟠 <b>${count}</b> círculo${count !== 1 ? 's' : ''}`
            );
            layer.on('mouseover', function() {
                this.setStyle({ weight: 2, color: '#ff7e00' });
                this.openPopup();
            });
            layer.on('mouseout', function() {
                if (window._choroplethLayer) window._choroplethLayer.resetStyle(this);
                this.closePopup();
            });
        }
    }).addTo(window.map);

    window._agregarLeyendaMapa(maxCount, conteo);
    window.map.fitBounds(window._choroplethLayer.getBounds(), { padding: [10, 10] });
};

// ==========================================
// 5. CENTRO DE MANDO Y MATRIZ DE PERMISOS (RBAC)
// ==========================================

window.abrirCentroMando = async function() {
    // 1. Verificación client-side básica
    if (!window.hasPermission('centro_mando')) return alert("Acceso denegado.");

    // 2. Verificación server-side: confirmar que la sesión PHP es real
    //    Esto bloquea a cualquiera que manipule window.CRM.currentUser desde la consola
    try {
        const res  = await apiFetch(`${window.API_URL}?action=check_session`);
        const data = await res.json();
        if (!data || data.status !== 'success' || !data.usuario) {
            alert("⛔ Sesión no válida en el servidor. Por favor inicia sesión nuevamente.");
            return;
        }
        // Doble check: el rol del servidor debe coincidir con el cliente
        const rolServidor  = data.rol  || '';
        const rolCliente   = window.CRM.currentUser?.rol || '';
        const rolesAdmin   = ['admin','superadmin','secretario_nacional','coordinador_nacional'];
        if (rolServidor !== rolCliente || !rolesAdmin.includes(rolServidor)) {
            alert("⛔ Acceso no autorizado. El rol del servidor no coincide.");
            return;
        }
    } catch(e) {
        alert("⛔ No se pudo verificar la sesión con el servidor. Intenta de nuevo.");
        return;
    }

    const thead = document.querySelector('#tablaPermisosAdmin thead tr');
    if (thead) {
        thead.innerHTML = `<th>Rol / Cargo</th> <th>👤 Crear Usr</th> <th>✏️ Editar Usr</th> <th>👥 Ver Todos</th> <th>📊 Rep. Est.</th> <th>🌎 Rep. Circ.</th> <th>🛡️ Mando</th>`;
    }

    window.openModal('modalCentroMando');
    window.initRoleManager();
    window.loadTrafficRules();
    window.renderPermissionsMatrix();
    window.cargarTodasSolicitudes();
    window.switchSolicitudTab('rol');
    if (window.hasPermission('delete_items')) {
        window.renderUserControlPanel();
        window.renderMaintenancePanel();
    }
};

// ====================================================================
// SOLICITUDES DE CAMBIO DE ROL (ADMIN)
// ====================================================================

window.cargarSolicitudesRol = async function() {
    const container = document.getElementById('listaSolicitudesRol');
    const badge     = document.getElementById('badgeSolicitudesRol');
    if (!container) return;

    container.innerHTML = '<p class="small" style="text-align:center;color:#aaa;padding:20px;">Cargando...</p>';

    try {
        const res  = await apiFetch(`${window.API_URL}?action=get_role_requests`);
        const data = await res.json();

        if (data.status !== 'success' || !data.requests) throw new Error(data.message || 'Error');

        const requests = data.requests;
        const pendientes = requests.filter(r => r.estado === 'pendiente');

        // Badge
        if (badge) {
            if (pendientes.length > 0) {
                badge.textContent = pendientes.length;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }

        if (requests.length === 0) {
            container.innerHTML = '<p class="small" style="text-align:center;color:#aaa;padding:20px;">No hay solicitudes registradas.</p>';
            return;
        }

        const ROLE_LABELS = {
            admin: 'Admin', superadmin: 'Super Admin',
            coordinador_nacional: 'Coordinador Nacional', secretario_nacional: 'Secretario Nacional',
            validacion: 'Validación', secretario_estatal: 'Secretario Estatal',
            secretario_municipal: 'Secretario Municipal', delegado_estatal_jovenes: 'Del. Estatal Jóvenes',
            delegado_estatal_mujeres: 'Del. Estatal Mujeres', delegado_estatal_trabajadores: 'Del. Estatal Trabajadores',
            delegado_estatal_fundacion: 'Del. Estatal Fundación', coordinador_estatal_usa: 'Coord. Estatal USA'
        };
        const customRoles = window.CRM.APP?.customRoles || [];
        const label = r => ROLE_LABELS[r] || customRoles.find(c => c.value === r)?.label || r;

        const rows = requests.map(r => {
            const estadoColor = { pendiente: '#e65100', aprobado: '#2e7d32', rechazado: '#c62828' }[r.estado] || '#333';
            const estadoBadge = `<span style="background:${estadoColor};color:#fff;font-size:10px;padding:2px 7px;border-radius:10px;text-transform:uppercase;">${r.estado}</span>`;

            const acciones = r.estado === 'pendiente' ? `
                <button class="primary-btn small-btn" style="background:#2e7d32;margin-right:4px;" onclick="window.resolverSolicitudRol(${r.id},'aprobado')">✅ Aprobar</button>
                <button class="secondary-btn small-btn" style="background:#c62828;color:#fff;" onclick="window.resolverSolicitudRol(${r.id},'rechazado')">❌ Rechazar</button>` : `
                <small style="color:#999;">Resuelto por: ${r.resuelto_por || '—'}</small>`;

            const fecha = r.created_at ? r.created_at.substring(0, 16).replace('T', ' ') : '—';

            return `
            <div style="padding:12px 15px;border-bottom:1px solid #f0f0f0;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px;">
                    <div>
                        <strong>${r.nombre || r.usuario}</strong>
                        <small style="color:#666;"> (@${r.usuario})</small><br>
                        <small style="color:#555;">
                            ROL actual: <strong>${label(r.rol_actual)}</strong>
                            → Solicita: <strong style="color:#7b1fa2;">${label(r.rol_solicitado)}</strong>
                        </small><br>
                        ${r.motivo ? `<small style="color:#777;font-style:italic;">"${r.motivo.substring(0, 120)}"</small><br>` : ''}
                        <small style="color:#aaa;">${fecha}</small>
                    </div>
                    <div style="text-align:right;">
                        ${estadoBadge}<br>
                        <div style="margin-top:6px;">${acciones}</div>
                    </div>
                </div>
            </div>`;
        }).join('');

        container.innerHTML = rows || '<p class="small" style="text-align:center;color:#aaa;padding:20px;">Sin solicitudes.</p>';

    } catch (e) {
        container.innerHTML = `<p class="small" style="text-align:center;color:#c62828;padding:20px;">Error al cargar: ${e.message}</p>`;
    }
};

window.resolverSolicitudRol = async function(id, decision) {
    const accion = decision === 'aprobado' ? 'APROBAR' : 'RECHAZAR';
    const nota = decision === 'rechazado'
        ? (prompt(`Motivo del rechazo (opcional):`) || '')
        : '';

    if (!confirm(`¿${accion} esta solicitud de cambio de ROL?`)) return;

    try {
        const res  = await apiFetch(`${window.API_URL}?action=resolve_role_request`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ id, decision, nota })
        });
        const data = await res.json();

        if (data.status === 'success') {
            alert('✅ ' + data.message);
            window.cargarTodasSolicitudes();
            if (decision === 'aprobado' && window.loadDataFromCloud) window.loadDataFromCloud();
        } else {
            alert('⚠️ ' + (data.message || 'Error al procesar.'));
        }
    } catch (e) {
        alert('Error de conexión: ' + e.message);
    }
};

// ====================================================================
// SOLICITUDES DE BORRADO — PANEL UNIFICADO
// ====================================================================

// Carga ambas listas (rol + borrado) y actualiza badges
window.cargarTodasSolicitudes = async function() {
    await Promise.all([
        window.cargarSolicitudesRol(),
        window.cargarSolicitudesBorrado()
    ]);
    // Badge total combinado
    const bRol     = parseInt(document.getElementById('badgeSolicitudesRol')?.textContent     || '0');
    const bBorrado = parseInt(document.getElementById('badgeSolicitudesBorrado')?.textContent || '0');
    const total    = bRol + bBorrado;
    const bTotal   = document.getElementById('badgeSolicitudesTotal');
    if (bTotal) { bTotal.textContent = total; bTotal.style.display = total > 0 ? 'inline-block' : 'none'; }
};

// Cambiar pestaña activa en el panel de solicitudes
window.switchSolicitudTab = function(tab) {
    const tabs     = ['rol', 'borrado'];
    const ACTIVE   = 'background:#7b1fa2; color:#fff; border-color:#7b1fa2;';
    const INACTIVE = '';

    tabs.forEach(t => {
        const btn     = document.getElementById(`tabBtnSolicitud_${t}`);
        const content = document.getElementById(`tabSolicitudes_${t}`);
        if (!btn || !content) return;
        const isActive = t === tab;
        btn.style.cssText    = isActive ? ACTIVE : INACTIVE;
        content.style.display = isActive ? 'block' : 'none';
    });
};

// Cargar solicitudes de borrado en su pestaña
window.cargarSolicitudesBorrado = async function() {
    const container = document.getElementById('listaSolicitudesBorrado');
    const badge     = document.getElementById('badgeSolicitudesBorrado');
    if (!container) return;

    container.innerHTML = '<p class="small" style="text-align:center;color:#aaa;padding:20px;">Cargando...</p>';

    try {
        const res  = await apiFetch(`${window.API_URL}?action=get_deletion_requests`);
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message || 'Error');

        const requests  = data.requests || [];
        const pendientes = requests.filter(r => r.estado === 'pendiente');

        if (badge) {
            badge.textContent    = pendientes.length;
            badge.style.display  = pendientes.length > 0 ? 'inline-block' : 'none';
        }

        if (requests.length === 0) {
            container.innerHTML = '<p class="small" style="text-align:center;color:#aaa;padding:20px;">No hay solicitudes de borrado.</p>';
            return;
        }

        const tipoIcon = { usuario: '👤', circulo: '⭕' };

        const rows = requests.map(r => {
            const estadoColor = { pendiente: '#e65100', aprobado: '#2e7d32', rechazado: '#c62828' }[r.estado] || '#333';
            const estadoBadge = `<span style="background:${estadoColor};color:#fff;font-size:10px;padding:2px 7px;border-radius:10px;text-transform:uppercase;">${r.estado}</span>`;
            const fecha       = (r.created_at || '').substring(0, 16).replace('T', ' ');
            const icon        = tipoIcon[r.tipo] || '📄';

            const acciones = r.estado === 'pendiente' ? `
                <button class="primary-btn small-btn" style="background:#c62828;margin-right:4px;" onclick="window.resolverSolicitudBorrado(${r.id},'aprobado')">✅ Aprobar borrado</button>
                <button class="secondary-btn small-btn" style="background:#555;color:#fff;" onclick="window.resolverSolicitudBorrado(${r.id},'rechazado')">❌ Rechazar</button>`
            : `<small style="color:#999;">Resuelto por: ${r.resuelto_por || '—'}</small>`;

            return `
            <div style="padding:12px 15px;border-bottom:1px solid #f0f0f0;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px;">
                    <div>
                        <strong>${icon} ${r.target_nombre || r.target_id}</strong>
                        <span style="font-size:10px;background:#eee;padding:1px 6px;border-radius:8px;margin-left:4px;text-transform:uppercase;">${r.tipo}</span><br>
                        <small style="color:#555;">Solicitado por: <strong>${r.solicitante_nombre || r.solicitante}</strong> (@${r.solicitante}) — ${r.solicitante_rol}</small><br>
                        ${r.motivo ? `<small style="color:#777;font-style:italic;">"${r.motivo.substring(0, 150)}"</small><br>` : ''}
                        ${r.resolucion_nota ? `<small style="color:#c62828;font-style:italic;">Nota: "${r.resolucion_nota}"</small><br>` : ''}
                        <small style="color:#aaa;">${fecha}</small>
                    </div>
                    <div style="text-align:right;">
                        ${estadoBadge}<br>
                        <div style="margin-top:6px;">${acciones}</div>
                    </div>
                </div>
            </div>`;
        }).join('');

        container.innerHTML = rows;

    } catch (e) {
        container.innerHTML = `<p class="small" style="text-align:center;color:#c62828;padding:20px;">Error: ${e.message}</p>`;
    }
};

// Resolver una solicitud de borrado (aprobar ejecuta el borrado real en backend)
window.resolverSolicitudBorrado = async function(id, decision) {
    const esAprobacion = decision === 'aprobado';
    const nota = !esAprobacion
        ? (prompt('Motivo del rechazo (opcional):') || '')
        : '';

    const msg = esAprobacion
        ? '⚠️ ADVERTENCIA: Esto borrará el elemento PERMANENTEMENTE. ¿Confirmas la aprobación?'
        : '¿Rechazar esta solicitud de borrado?';
    if (!confirm(msg)) return;

    try {
        const res  = await apiFetch(`${window.API_URL}?action=process_deletion_request`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ id, decision, nota })
        });
        const data = await res.json();

        if (data.status === 'success') {
            alert('✅ ' + data.message);
            window.cargarTodasSolicitudes();
            if (esAprobacion && window.loadDataFromCloud) window.loadDataFromCloud();
        } else {
            alert('⚠️ ' + (data.message || 'Error al procesar.'));
        }
    } catch (e) {
        alert('Error de conexión: ' + e.message);
    }
};

// Enviar solicitud de borrado (secretario_estatal desde lista de usuarios o círculos)
window.solicitarBorrado = async function(tipo, targetId, targetNombre) {
    const motivo = prompt(
        `Solicitar borrado de ${tipo === 'usuario' ? 'usuario' : 'círculo'}:\n"${targetNombre}"\n\nEscribe el motivo (obligatorio):`
    );
    if (!motivo || motivo.trim() === '') return alert('El motivo es obligatorio para enviar la solicitud.');

    try {
        const res  = await apiFetch(`${window.API_URL}?action=request_deletion`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ tipo, target_id: targetId, target_nombre: targetNombre, motivo: motivo.trim() })
        });
        const data = await res.json();
        if (data.status === 'success') {
            alert('📤 ' + data.message);
        } else {
            alert('⚠️ ' + (data.message || 'Error al enviar solicitud.'));
        }
    } catch (e) {
        alert('Error de conexión: ' + e.message);
    }
};

window.renderPermissionsMatrix = function() {
    const tbody = document.getElementById('bodyPermisos');
    if (!tbody) return;
    tbody.innerHTML = '';

    const cloudPerms = window.CRM.APP.trafficRules?.permissions || {};
    const overrides = window.CRM.APP.trafficRules?.roleOverrides || {};

    const roles = [...CORE_ROLES_IDS];
    const custom = window.CRM.APP.customRoles || [];
    custom.forEach(r => roles.push(r.value));

    roles.forEach(role => {
        let name = ROLE_NAMES[role] || (custom.find(c => c.value === role)?.label) || role;
        if(overrides[role]?.label) name = overrides[role].label;

        // Roles bloqueados: Nivel 1 (todo encendido) y Nivel 2 lectura (valores fijos distintos)
        const isNationalRole  = ROLES_NACIONALES_FULL.includes(role);
        const isReadonlyRole  = ROLES_NACIONALES_READONLY.includes(role);
        const isLockedRole    = isNationalRole || isReadonlyRole;
        const disabled        = isLockedRole ? 'disabled' : '';

        // Resolver valores: cloud perms > DEFAULT_PERMISSIONS > false
        const dp = (window.DEFAULT_PERMISSIONS && window.DEFAULT_PERMISSIONS[role]) || {};
        const cp = cloudPerms[role] || {};
        const val = (perm) => isNationalRole ? true : (isReadonlyRole ? (dp[perm] === true) : (cp[perm] !== undefined ? cp[perm] === true : dp[perm] === true));

        tbody.innerHTML += `
            <tr${isLockedRole ? ' style="background:#f8f9fa; opacity:.85;"' : ''}>
                <td><strong>${name}</strong><br><small style="color:#999;">${role}</small>${isNationalRole ? ' <span title="Permisos fijos — Nivel 1" style="font-size:10px;">🔒</span>' : ''}${isReadonlyRole ? ' <span title="Solo lectura — Nivel 2" style="font-size:10px;">👁️🔒</span>' : ''}</td>
                <td style="text-align:center;"><input type="checkbox" class="perm-cb" data-role="${role}" data-perm="create_users"       ${val('create_users')       ? 'checked' : ''} ${disabled}></td>
                <td style="text-align:center;"><input type="checkbox" class="perm-cb" data-role="${role}" data-perm="edit_users"         ${val('edit_users')         ? 'checked' : ''} ${disabled}></td>
                <td style="text-align:center;"><input type="checkbox" class="perm-cb" data-role="${role}" data-perm="delete_items"       ${val('delete_items')       ? 'checked' : ''} ${disabled}></td>
                <td style="text-align:center;"><input type="checkbox" class="perm-cb" data-role="${role}" data-perm="view_all_users"     ${val('view_all_users')     ? 'checked' : ''} ${disabled}></td>
                <td style="text-align:center;"><input type="checkbox" class="perm-cb" data-role="${role}" data-perm="view_state_reports" ${val('view_state_reports') ? 'checked' : ''} ${disabled}></td>
                <td style="text-align:center;"><input type="checkbox" class="perm-cb" data-role="${role}" data-perm="view_circ_reports"  ${val('view_circ_reports')  ? 'checked' : ''} ${disabled}></td>
                <td style="text-align:center;"><input type="checkbox" class="perm-cb" data-role="${role}" data-perm="centro_mando"       ${val('centro_mando')       ? 'checked' : ''} ${disabled}></td>
            </tr>
        `;
    });

    tbody.innerHTML += `
        <tr>
            <td colspan="7" style="text-align:right; padding-top: 15px;">
                <button class="primary-btn" onclick="window.savePermissionsMatrix()">💾 Guardar Matriz de Permisos</button>
            </td>
        </tr>
    `;
};

window.savePermissionsMatrix = async function() {
    const perms = {};
    document.querySelectorAll('.perm-cb').forEach(cb => {
        const role = cb.dataset.role;
        const perm = cb.dataset.perm;
        if (!perms[role]) perms[role] = {};
        perms[role][perm] = cb.checked;
    });

    if (!window.CRM.APP.trafficRules) window.CRM.APP.trafficRules = {};
    window.CRM.APP.trafficRules.permissions = perms;

    const btn = document.activeElement;
    const oldText = btn.textContent;
    btn.textContent = "Guardando..."; btn.disabled = true;

    try {
        if (typeof window.saveTrafficToCloud === 'function') {
            await window.saveTrafficToCloud(window.CRM.APP.trafficRules);
            alert("✅ Matriz de Permisos guardada en la Nube.");
            window.applyUIBasedOnPermissions();
        }
    } catch(e) { alert("Error: " + e.message); } 
    finally { btn.textContent = oldText; btn.disabled = false; }
};

window.handleCreateRole = async function(e) {
    e.preventDefault();
    const label = document.getElementById('new_role_label').value.trim();
    const value = window.normalizeText(document.getElementById('new_role_value').value.trim()).replace(/\s+/g, '_');
    const icon = document.getElementById('new_role_icon').value.trim() || '👤';

    if (!window.CRM.APP.customRoles) window.CRM.APP.customRoles = [];
    if (window.CRM.APP.customRoles.find(r => r.value === value)) return alert("Ya existe un rol con ese ID.");

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; 

    try {
        window.CRM.APP.customRoles.push({ label, value, icon });
        if (typeof window.saveTrafficToCloud === 'function') {
            await window.saveTrafficToCloud(window.CRM.APP.trafficRules || {});
            alert("✅ Rol creado.");
            e.target.reset(); 
            window.initRoleManager(); 
            window.updateStats(); 
            window.renderPermissionsMatrix();
        }
    } catch (err) { 
        window.CRM.APP.customRoles.pop(); 
        alert("Error: " + err.message);
    } 
    finally { btn.disabled = false; }
};

window.initRoleManager = function() {
    const list = document.getElementById('customRolesList');
    if(!list) return;
    
    const overrides = window.CRM.APP.trafficRules?.roleOverrides || {};
    
    let html = '<table class="report-table" style="font-size:12px; margin:0;"><thead><tr><th>ID Sistema</th><th>Tarjeta en Dashboard</th><th>Visibilidad</th><th>Acciones</th></tr></thead><tbody>';

    CORE_ROLES_IDS.forEach(role => {
        if (['admin', 'validacion'].includes(role)) return; 
        
        const ovr = overrides[role] || {};
        const isHidden = ovr.hidden === true;
        const label = ovr.label || ROLE_NAMES[role];
        
        html += `<tr>
            <td><small>${role}</small><br><span style="color:#666; font-size:10px;">🛡️ Fábrica</span></td>
            <td><strong>${label}</strong></td>
            <td>${isHidden ? '🙈 Oculto' : '👁️ Visible'}</td>
            <td style="min-width: 130px;">
                <button class="secondary-btn small-btn" onclick="window.toggleRoleVisibility('${role}', ${!isHidden})" style="margin:2px;">${isHidden ? '👁️ Mostrar' : '🙈 Ocultar'}</button>
                <button class="secondary-btn small-btn" onclick="window.renameRoleUI('${role}', '${label}')" style="margin:2px;">✏️ Renombrar</button>
            </td>
        </tr>`;
    });

    const customRoles = window.CRM.APP.customRoles || [];
    customRoles.forEach(r => {
        const ovr = overrides[r.value] || {};
        const isHidden = ovr.hidden === true;
        const label = ovr.label || r.label;
        
        html += `<tr>
            <td><small>${r.value}</small><br><span style="color:#28a745; font-size:10px;">➕ Creado</span></td>
            <td><strong>${r.icon || '👤'} ${label}</strong></td>
            <td>${isHidden ? '🙈 Oculto' : '👁️ Visible'}</td>
            <td style="min-width: 190px;">
                <button class="secondary-btn small-btn" onclick="window.toggleRoleVisibility('${r.value}', ${!isHidden})" style="margin:2px;">${isHidden ? '👁️ Mostrar' : '🙈 Ocultar'}</button>
                <button class="secondary-btn small-btn" onclick="window.renameRoleUI('${r.value}', '${label}')" style="margin:2px;">✏️ Nombre</button>
                <button class="secondary-btn small-btn" style="background:#dc3545; color:white; margin:2px;" onclick="window.handleDeleteRole('${r.value}')">🗑️ Borrar</button>
            </td>
        </tr>`;
    });

    html += '</tbody></table>';
    list.innerHTML = html;
};

window.toggleRoleVisibility = async function(roleId, makeHidden) {
    if (!window.CRM.APP.trafficRules) window.CRM.APP.trafficRules = {};
    if (!window.CRM.APP.trafficRules.roleOverrides) window.CRM.APP.trafficRules.roleOverrides = {};
    
    if (!window.CRM.APP.trafficRules.roleOverrides[roleId]) window.CRM.APP.trafficRules.roleOverrides[roleId] = {};
    window.CRM.APP.trafficRules.roleOverrides[roleId].hidden = makeHidden;
    
    try {
        await window.saveTrafficToCloud(window.CRM.APP.trafficRules);
        window.initRoleManager();
        window.updateStats();
    } catch(e) { alert("Error guardando visibilidad."); }
};

window.renameRoleUI = async function(roleId, currentLabel) {
    const newLabel = prompt(`Escribe el nuevo nombre que aparecerá en la tarjeta del Dashboard para este rol:`, currentLabel);
    if (!newLabel || newLabel === currentLabel) return;

    if (!window.CRM.APP.trafficRules) window.CRM.APP.trafficRules = {};
    if (!window.CRM.APP.trafficRules.roleOverrides) window.CRM.APP.trafficRules.roleOverrides = {};
    
    if (!window.CRM.APP.trafficRules.roleOverrides[roleId]) window.CRM.APP.trafficRules.roleOverrides[roleId] = {};
    window.CRM.APP.trafficRules.roleOverrides[roleId].label = newLabel;
    
    try {
        await window.saveTrafficToCloud(window.CRM.APP.trafficRules);
        window.initRoleManager();
        window.updateStats();
    } catch(e) { alert("Error guardando el nombre."); }
};

window.handleDeleteRole = async function(val) {
    if(!confirm("¿Seguro que deseas BORRAR este rol por completo? Los usuarios asignados no se borrarán, pero perderán su tarjeta en el sistema.")) return;
    // Guardar copia para rollback en caso de error
    const backup = window.CRM.APP.customRoles.find(r => r.value === val);
    window.CRM.APP.customRoles = window.CRM.APP.customRoles.filter(r => r.value !== val);
    try {
        await window.saveTrafficToCloud(window.CRM.APP.trafficRules || {});
        window.initRoleManager(); window.updateStats(); window.renderPermissionsMatrix();
    } catch(e) {
        // Restaurar el rol eliminado si falla la persistencia
        if (backup) window.CRM.APP.customRoles.push(backup);
        alert("Error al eliminar el rol: " + e.message);
    }
};

window.loadTrafficRules = function() {
    const day = document.getElementById('trafficDaySelect').value;
    const rules = (window.CRM.APP.trafficRules || {})[day] || { states: "ALL", roles: "ALL" };
    const container = document.getElementById('trafficStateChecks');
    container.innerHTML = '';
    ESTADOS_MX_ADMIN.forEach(est => {
        const isChecked = (rules.states === "ALL" || rules.states.includes(est)) ? 'checked' : '';
        container.innerHTML += `<label style="font-size:11px;"><input type="checkbox" class="traffic-state" value="${est}" ${isChecked}> ${est}</label>`;
    });
};

window.saveTrafficRules = async function() {
    const day = document.getElementById('trafficDaySelect').value;
    const states = []; document.querySelectorAll('.traffic-state:checked').forEach(cb => states.push(cb.value));
    const allStatesCount = document.querySelectorAll('.traffic-state').length;

    if(!window.CRM.APP.trafficRules) window.CRM.APP.trafficRules = {};
    window.CRM.APP.trafficRules[day] = {
        states: (states.length === allStatesCount || states.length === 0) ? "ALL" : states,
        roles: "ALL"
    };
    if(states.length === 0) window.CRM.APP.trafficRules[day].states = [];

    try {
        if(typeof window.saveTrafficToCloud === 'function') {
            await window.saveTrafficToCloud(window.CRM.APP.trafficRules);
            alert(`✅ Reglas de tráfico actualizadas.`);
        }
    } catch(e) { alert("Error al guardar reglas de tráfico: " + e.message); }
};
window.toggleTrafficAllStates = function(status) { document.querySelectorAll('.traffic-state').forEach(cb => cb.checked = status); };

// ======================================================
// 6. 📡 RADAR DE OPERADORES EN TIEMPO REAL
// ======================================================

window.abrirRadarOperadores = async function() {
    const user = window.CRM.currentUser;
    if (!window.hasPermission('centro_mando')) {
        return alert("⛔ Acceso Restringido. Nivel de autorización insuficiente.");
    }

    window.openModal('modalRadar');
    const container = document.getElementById('radar-content');
    container.innerHTML = '<div style="text-align:center; padding: 30px;"><h3>📡 Escaneando frecuencias...</h3><p>Buscando operadores conectados...</p></div>';

    try {
        const data = await window.apiFetch('load_initial_data');
        if (data.users) window.CRM.APP.users = data.users;
    } catch (e) {
        console.warn("Fallo al contactar la antena del servidor.", e);
    }

    let html = '<ul style="list-style:none; padding:0; margin:0;">';
    let conectadosCount = 0;

    let operadoresVisibles = window.CRM.APP.users;
    if (user.rol === 'secretario_estatal') {
        operadoresVisibles = operadoresVisibles.filter(u => u.estado === user.estado);
    }

    const overrides = window.CRM.APP.trafficRules?.roleOverrides || {};

    operadoresVisibles.forEach(u => {
        if (!u.ultima_conexion) return;

        const lastConn = new Date(u.ultima_conexion.replace(' ', 'T'));
        const now = new Date();
        const diffMinutes = Math.floor((now - lastConn) / (1000 * 60));

        let status = '';
        let dotClass = '';
        let statusColor = '';

        if (diffMinutes <= 3) {
            status = 'Activo ahora';
            dotClass = 'radar-dot-active'; 
            statusColor = '#28a745';
            conectadosCount++;
        } else if (diffMinutes > 3 && diffMinutes <= 30) {
            status = `Ausente (${diffMinutes} min)`;
            dotClass = 'radar-dot-away'; 
            statusColor = '#ffc107';
            conectadosCount++;
        } else {
            return; 
        }

        const ubicationText = user.rol === 'secretario_estatal' ? (u.municipio || "Estatal") : u.estado;
        
        let displayRole = ROLE_NAMES[u.rol] || u.rol;
        if (overrides[u.rol] && overrides[u.rol].label) displayRole = overrides[u.rol].label;

        html += `
            <li style="padding: 12px; border-bottom: 1px solid #eee; display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div class="${dotClass}"></div>
                    <div>
                        <strong style="font-size:14px;">${window.toTitleCase(u.nombre)}</strong><br>
                        <span style="font-size:11px; color:#666;">${displayRole.toUpperCase()} | ${ubicationText}</span>
                    </div>
                </div>
                <div style="font-size:12px; color:${statusColor}; font-weight:bold; text-align:right;">
                    ${status}
                </div>
            </li>
        `;
    });

    html += '</ul>';

    if (conectadosCount === 0) {
        html = '<div style="text-align:center; padding:20px; color:#666;">No hay operadores activos en tu territorio en este momento.</div>';
    }

    const tituloRadar = user.rol === 'secretario_estatal' ? `Radar Estatal: ${user.estado}` : 'Radar Nacional';

    container.innerHTML = `
        <div style="margin-bottom: 15px; text-align:center; border-bottom: 2px solid #eee; padding-bottom: 10px;">
            <h2 style="margin:0; color:#333;">📡 ${tituloRadar}</h2>
            <p style="margin:0; font-size:13px; color:#666;">Operadores conectados: <b>${conectadosCount}</b></p>
        </div>
        <div style="max-height: 400px; overflow-y: auto;">
            ${html}
        </div>
        <button class="primary-btn" style="width:100%; margin-top:15px; background: #333;" onclick="window.abrirRadarOperadores()">🔄 Re-escanear</button>
    `;
};

// ======================================================
// 7. 📊 EXPORTADOR A EXCEL (DIRECTORIO NACIONAL LIMPIO)
// ======================================================

window.exportarCDBAExcel = function() {
    const user = window.CRM.currentUser;
    if (!user || !ROLES_NACIONALES_FULL.includes(user.rol)) {
        return alert("⛔ ACCESO DENEGADO: Nivel de autorización insuficiente. Solo la Coordinación Nacional puede descargar la base de datos.");
    }

    if (!window.XLSX) {
        return alert("⚠️ La librería de Excel está cargando, por favor intenta en 3 segundos.");
    }
    
    const { circles } = window.getAccessibleData();
    if (circles.length === 0) return alert("No hay datos para exportar.");

    if (!confirm(`Se generará un archivo Excel con la información de ${circles.length} círculos. ¿Deseas continuar?`)) return;

    let dataFlat = [];
    
    circles.forEach(c => {
        if(!c.cedulas) return;
        c.cedulas.forEach(m => {
            dataFlat.push({
                "ESTADO": c.acta.estado,
                "MUNICIPIO/ALCALDÍA": c.acta.municipio,
                "NOMBRE DEL CÍRCULO": c.acta.nombre,
                "FECHA CREACIÓN": c.acta.fecha,
                "COORDINADOR DEL CÍRCULO": window.toTitleCase(c.acta.coordinador),
                "NOMBRE INTEGRANTE": m.nombre,
                "CARGO": m.es_coordinador ? "Coordinador de Círculo" : "Integrante",
                "TELÉFONO CELULAR": m.telefono,
                "EMAIL": m.email || "N/A",
                "CLAVE DE ELECTOR": m.clave_elector || "N/A",
                "CURP": m.curp || "N/A",
                "SECCIÓN ELECTORAL": m.seccion || "N/A",
                "GÉNERO": m.sexo || "N/A",
                "DOMICILIO": m.domicilio || "N/A",
                "CAUSAS/TEMAS": c.causas && c.causas.length > 0 ? c.causas.join(", ") : (c.actividades && c.actividades.length > 0 ? c.actividades.join(", ") : "Sin definir")
            });
        });
    });

    const worksheet = window.XLSX.utils.json_to_sheet(dataFlat);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, "Directorio");

    const fechaHoy = new Date().toLocaleDateString().replace(/\//g, '-');
    window.XLSX.writeFile(workbook, `Base_Datos_Circulos_${fechaHoy}.xlsx`);
};

// ======================================================
// 11. 🔥 NUEVO: REPORTE DE AUDITORÍA DE VALIDACIÓN 🔥
// ======================================================

window.abrirReporteValidacion = function() {
    const user = window.CRM.currentUser;
    if (!user || !ROLES_NACIONALES_FULL.includes(user.rol)) {
        return alert("⛔ Acceso restringido. Solo la Coordinación Nacional puede auditar a la Mesa de Validación.");
    }

    const data = window.getAccessibleData ? window.getAccessibleData() : { circles: window.CRM.APP.circles };
    const circles = data.circles || [];

    let pendientes = 0, aprobados = 0, observados = 0;
    let rendimiento = {};
    let rezago = {};

    circles.forEach(c => {
        const status = c.status || 'pendiente';
        const validador = c.validado_por || 'Sistema / Sin registro previo';
        const estado = c.acta?.estado || 'Sin Estado';

        if (status === 'pendiente' || status === '') {
            pendientes++;
            rezago[estado] = (rezago[estado] || 0) + 1;
        } else if (status === 'validado') {
            aprobados++;
            if(!rendimiento[validador]) rendimiento[validador] = { aprobados: 0, observados: 0 };
            rendimiento[validador].aprobados++;
        } else if (status === 'revision') {
            observados++;
            if(!rendimiento[validador]) rendimiento[validador] = { aprobados: 0, observados: 0 };
            rendimiento[validador].observados++;
        }
    });

    let html = `
        <div style="text-align: right; margin-bottom: 15px;">
            <button class="primary-btn" onclick="window.handleExportAuditoriaPDF()" style="background:#673ab7; border:none; padding: 10px 15px;">📄 Exportar Reporte a PDF</button>
        </div>
        <div style="display:flex; gap:15px; margin-bottom:20px; flex-wrap:wrap;">
            <div style="flex:1; min-width:120px; background:#fff3cd; padding:15px; border-radius:8px; border:1px solid #ffeeba; text-align:center;">
                <h3 style="margin:0; color:#856404; font-size:28px;">${pendientes}</h3>
                <span style="color:#856404; font-size:12px; font-weight:bold;">PENDIENTES (REZAGO)</span>
            </div>
            <div style="flex:1; min-width:120px; background:#d4edda; padding:15px; border-radius:8px; border:1px solid #c3e6cb; text-align:center;">
                <h3 style="margin:0; color:#155724; font-size:28px;">${aprobados}</h3>
                <span style="color:#155724; font-size:12px; font-weight:bold;">APROBADOS</span>
            </div>
            <div style="flex:1; min-width:120px; background:#f8d7da; padding:15px; border-radius:8px; border:1px solid #f5c6cb; text-align:center;">
                <h3 style="margin:0; color:#721c24; font-size:28px;">${observados}</h3>
                <span style="color:#721c24; font-size:12px; font-weight:bold;">RECHAZADOS / OBSERVADOS</span>
            </div>
        </div>
    `;

    html += `<h4 style="color:#333; border-bottom:2px solid #673ab7; padding-bottom:5px;">🕵️‍♂️ Desempeño por Validador</h4>`;
    html += `<div style="max-height: 250px; overflow-y: auto; margin-bottom:25px; border: 1px solid #eee;">
                <table class="report-table">
                    <thead style="position: sticky; top: 0;">
                        <tr>
                            <th>Usuario (Validador)</th>
                            <th style="text-align:center;">✅ Aprobados</th>
                            <th style="text-align:center;">❌ Observados</th>
                            <th style="text-align:center;">Total Procesados</th>
                        </tr>
                    </thead>
                    <tbody>`;
    
    const rendimientoArray = Object.entries(rendimiento).map(([user, stats]) => ({
        user, 
        ...stats, 
        total: stats.aprobados + stats.observados
    })).sort((a, b) => b.total - a.total);

    rendimientoArray.forEach(val => {
        html += `<tr>
            <td><strong>${val.user}</strong></td>
            <td style="color:green; font-weight:bold; text-align:center;">${val.aprobados}</td>
            <td style="color:red; font-weight:bold; text-align:center;">${val.observados}</td>
            <td style="text-align:center; font-weight:bold;">${val.total}</td>
        </tr>`;
    });
    
    if(rendimientoArray.length === 0) html += `<tr><td colspan="4" style="text-align:center;">No hay registros de validación en el sistema.</td></tr>`;
    html += `</tbody></table></div>`;

    html += `<h4 style="color:#333; border-bottom:2px solid #ff7e00; padding-bottom:5px;">📍 Mapa de Rezago (Pendientes por Estado)</h4>`;
    html += `<div style="max-height: 250px; overflow-y: auto; border: 1px solid #eee;">
                <table class="report-table">
                    <thead style="position: sticky; top: 0;">
                        <tr>
                            <th>Estado</th>
                            <th style="text-align:center;">Círculos en Espera</th>
                            <th style="text-align:center;">Nivel de Urgencia</th>
                        </tr>
                    </thead>
                    <tbody>`;
    
    const rezagoSorted = Object.entries(rezago).sort((a, b) => b[1] - a[1]);
    
    rezagoSorted.forEach(([estado, count]) => {
        let urgencia = '<span class="badge badge-yellow" style="color:#000;">Normal</span>';
        if (count > 25) urgencia = '<span class="badge badge-red" style="background:#ff7e00;">Atención</span>';
        if (count > 75) urgencia = '<span class="badge badge-red">Crítico</span>';
        
        html += `<tr>
            <td><strong>${estado}</strong></td>
            <td style="text-align:center; font-weight:bold; color:#856404;">${count}</td>
            <td style="text-align:center;">${urgencia}</td>
        </tr>`;
    });
    
    if(rezagoSorted.length === 0) html += `<tr><td colspan="3" style="text-align:center;">¡Excelente! No hay círculos en rezago.</td></tr>`;
    html += `</tbody></table></div>`;

    document.getElementById('auditoria-validacion-content').innerHTML = html;
    window.openModal('modalAuditoriaValidacion');
};

// ═══════════════════════════════════════════════════════════════════════════
// v15.17 — Bitácora del Sistema (Audit Log)
// ═══════════════════════════════════════════════════════════════════════════
window.renderBitacora = async function() {
    const el = document.getElementById('bitacora-content');
    if (!el) return;
    el.innerHTML = '<p style="text-align:center;color:#888;padding:20px;">⏳ Cargando bitácora...</p>';

    try {
        const r = await apiFetch(`${window.API_URL}?action=get_audit_log`);
        const res = await r.json();
        if (res.status !== 'success') { el.innerHTML = `<p style="color:red;">${res.message}</p>`; return; }
        const logs = res.data || [];
        if (!logs.length) { el.innerHTML = '<p style="text-align:center;color:#888;padding:20px;">No hay registros aún.</p>'; return; }

        const iconMap = {
            login: '🔑', logout: '🚪',
            crear_usuario: '👤➕', editar_usuario: '✏️', eliminar_usuario: '🗑️👤',
            eliminar_circulo: '🗑️⭕', reclasificar_usuario: '🔄',
            default: '📋'
        };
        const colorMap = {
            login: '#e8f5e9', logout: '#fff3e0',
            crear_usuario: '#e3f2fd', editar_usuario: '#f3e5f5', eliminar_usuario: '#ffebee',
            eliminar_circulo: '#ffebee', reclasificar_usuario: '#e8eaf6',
            default: '#fafafa'
        };

        let html = `<div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#333;color:#fff;">
            <th style="padding:6px 8px;text-align:left;">Hora</th>
            <th style="padding:6px 8px;text-align:left;">Actor</th>
            <th style="padding:6px 8px;text-align:left;">Acción</th>
            <th style="padding:6px 8px;text-align:left;">Objetivo</th>
            <th style="padding:6px 8px;text-align:left;">Detalle</th>
            <th style="padding:6px 8px;text-align:left;">IP</th>
        </tr></thead><tbody>`;

        logs.forEach(row => {
            const ic = iconMap[row.accion] || iconMap.default;
            const bg = colorMap[row.accion] || colorMap.default;
            const dt = new Date(row.created_at);
            const dtStr = isNaN(dt) ? row.created_at : dt.toLocaleString('es-MX', {
                year:'numeric', month:'2-digit', day:'2-digit',
                hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false
            });
            html += `<tr style="background:${bg};border-bottom:1px solid #e0e0e0;">
                <td style="padding:5px 8px;white-space:nowrap;font-family:monospace;font-size:11px;">${dtStr}</td>
                <td style="padding:5px 8px;font-weight:bold;">${row.actor || ''}</td>
                <td style="padding:5px 8px;white-space:nowrap;">${ic} ${row.accion || ''}</td>
                <td style="padding:5px 8px;">${row.objetivo || ''}</td>
                <td style="padding:5px 8px;color:#555;font-size:11px;max-width:220px;word-break:break-word;">${row.detalle || ''}</td>
                <td style="padding:5px 8px;color:#888;font-size:11px;white-space:nowrap;">${row.ip || ''}</td>
            </tr>`;
        });

        html += `</tbody></table></div>
        <p style="text-align:right;font-size:11px;color:#aaa;margin-top:8px;">Mostrando los últimos ${logs.length} registros.</p>`;
        el.innerHTML = html;
    } catch(e) {
        el.innerHTML = `<p style="color:red;">Error al cargar: ${e.message}</p>`;
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// v15.17 — Ordenar Delegados (reclasificación de roles)
// ═══════════════════════════════════════════════════════════════════════════
const _DELEGADOS_ESTATALES_ROLES = {
    delegado_estatal_jovenes:      { label: 'Mov. Jóvenes',         municipal: 'delegado_municipal_jovenes' },
    delegado_estatal_mujeres:      { label: 'Mov. Mujeres',         municipal: 'delegado_municipal_mujeres' },
    delegado_estatal_trabajadores: { label: 'Trab. y Prod.',        municipal: 'delegado_municipal_trabajadores' },
    delegado_estatal_fundacion:    { label: 'Fund. Méx. Valores',   municipal: 'delegado_municipal_fundacion' },
    delegado_estatal_productores:  { label: 'Campus Naranja',       municipal: 'delegado_municipal_productores' },
    delegado_estatal_migrante_usa: { label: 'USA Migrante',         municipal: 'delegado_municipal_migrante_usa' }
};

window.renderOrdenarDelegados = function() {
    const el = document.getElementById('ordenar-delegados-content');
    if (!el) return;

    const users = (window.CRM && window.CRM.APP && window.CRM.APP.users) ? window.CRM.APP.users : [];
    const estatales = Object.keys(_DELEGADOS_ESTATALES_ROLES);

    // Group by rol → estado
    const grupos = {};
    estatales.forEach(rol => { grupos[rol] = {}; });

    users.forEach(u => {
        if (!estatales.includes(u.rol)) return;
        const est = u.estado || 'Sin Estado';
        if (!grupos[u.rol][est]) grupos[u.rol][est] = [];
        grupos[u.rol][est].push(u);
    });

    let html = '';
    let hayDuplicados = false;

    estatales.forEach(rol => {
        const info = _DELEGADOS_ESTATALES_ROLES[rol];
        const estadoMap = grupos[rol];
        const estados = Object.keys(estadoMap);
        if (!estados.length) return;

        const duplicados = estados.filter(e => estadoMap[e].length > 1);
        if (duplicados.length) hayDuplicados = true;

        html += `<div style="margin-bottom:20px;border:1px solid #ddd;border-radius:8px;overflow:hidden;">
        <div style="background:#37474f;color:#fff;padding:8px 14px;font-weight:bold;font-size:13px;">
            ${info.label} — <span style="font-weight:normal;font-size:11px;opacity:0.8;">${rol}</span>
            ${duplicados.length ? `<span style="margin-left:10px;background:#d32f2f;color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;">⚠️ ${duplicados.length} estado(s) con duplicado</span>` : '<span style="margin-left:10px;background:#2e7d32;color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;">✅ OK</span>'}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#f5f5f5;">
            <th style="padding:5px 10px;text-align:left;">Estado</th>
            <th style="padding:5px 10px;text-align:left;">Usuario</th>
            <th style="padding:5px 10px;text-align:left;">Nombre</th>
            <th style="padding:5px 10px;text-align:center;">Acción</th>
        </tr></thead><tbody>`;

        estados.sort().forEach(estado => {
            const lista = estadoMap[estado];
            lista.forEach((u, idx) => {
                const esDuplicado = lista.length > 1;
                const rowBg = esDuplicado ? (idx === 0 ? '#fff8e1' : '#ffebee') : '#fff';
                html += `<tr style="background:${rowBg};border-bottom:1px solid #eee;">
                    <td style="padding:5px 10px;font-weight:${idx===0?'bold':'normal'};color:${esDuplicado&&idx>0?'#c62828':'#333'};">
                        ${idx === 0 ? estado : '↳ ' + estado}
                        ${esDuplicado && idx === 0 ? '<span style="font-size:10px;color:#f57f17;margin-left:4px;">(titular)</span>' : ''}
                        ${esDuplicado && idx > 0 ? '<span style="font-size:10px;color:#c62828;margin-left:4px;">(duplicado)</span>' : ''}
                    </td>
                    <td style="padding:5px 10px;font-family:monospace;">${u.usuario}</td>
                    <td style="padding:5px 10px;">${u.nombre || ''}</td>
                    <td style="padding:5px 10px;text-align:center;">
                        ${esDuplicado && idx > 0
                            ? `<button onclick="window.quickReclassify('${u.usuario}','${info.municipal}')"
                                style="font-size:11px;padding:4px 10px;background:#1565c0;color:#fff;border:none;border-radius:4px;cursor:pointer;">
                                ↓ Mover a Municipal</button>`
                            : '<span style="color:#aaa;font-size:11px;">—</span>'
                        }
                    </td>
                </tr>`;
            });
        });

        html += `</tbody></table></div>`;
    });

    if (!html) html = '<p style="text-align:center;color:#888;padding:20px;">No hay delegados estatales registrados aún.</p>';
    else if (!hayDuplicados) html = '<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:12px;margin-bottom:16px;color:#2e7d32;font-weight:bold;">✅ No hay duplicados. La estructura está ordenada.</div>' + html;

    el.innerHTML = html;
};

window.quickReclassify = async function(usuario, newRol) {
    if (!confirm(`¿Cambiar el rol de "${usuario}" a "${newRol}"?\n\nEsto lo moverá de delegado estatal a delegado municipal.`)) return;

    try {
        const r = await apiFetch(`${window.API_URL}?action=reclassify_users`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ cambios: [{ usuario, rol: newRol }] })
        });
        const res = await r.json();
        if (res.status !== 'success') { alert('Error: ' + res.message); return; }

        // Update local cache
        const u = (window.CRM.APP.users || []).find(x => x.usuario === usuario);
        if (u) u.rol = newRol;

        alert(`✅ ${usuario} ahora tiene rol: ${newRol}`);
        window.renderOrdenarDelegados();   // Refresh the view
    } catch(e) {
        alert('Error: ' + e.message);
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// v15.18 — Importación Masiva de Usuarios desde Excel / CSV
// ═══════════════════════════════════════════════════════════════════════════

const _ABBR_ESTADO = {
    'Aguascalientes':'AGS','Baja California':'BCN','Baja California Sur':'BCS',
    'Campeche':'CAM','Chiapas':'CHP','Chihuahua':'CHH','Ciudad de México':'CMX',
    'Coahuila':'COA','Colima':'COL','Durango':'DGO','Estado de México':'MEX',
    'Guanajuato':'GTO','Guerrero':'GRO','Hidalgo':'HGO','Jalisco':'JAL',
    'Michoacán':'MIC','Morelos':'MOR','Nayarit':'NAY','Nuevo León':'NLE',
    'Oaxaca':'OAX','Puebla':'PUE','Querétaro':'QRO','Quintana Roo':'ROO',
    'San Luis Potosí':'SLP','Sinaloa':'SIN','Sonora':'SON','Tabasco':'TAB',
    'Tamaulipas':'TAM','Tlaxcala':'TLA','Veracruz':'VER','Yucatán':'YUC',
    'Zacatecas':'ZAC'
};

// Roles válidos para importación (incluye roles municipales)
const _TODOS_ROLES_IMPORT = [
    ...CORE_ROLES_IDS,
    'coordinador_municipal',
    'delegado_municipal_jovenes','delegado_municipal_mujeres',
    'delegado_municipal_trabajadores','delegado_municipal_fundacion',
    'delegado_municipal_productores','delegado_municipal_migrante_usa'
];

// Aliases de columnas (para leer cualquier Excel sin reformatear)
const _COL_ALIASES = {
    usuario:   ['usuario','username','user','login','cuenta'],
    nombre:    ['nombre','nombre_completo','name','nombre completo','nombreapellido'],
    rol:       ['rol','role','cargo','puesto','perfil'],
    estado:    ['estado','state','entidad','entidad_federativa'],
    municipio: ['municipio','ciudad','city','mpio','municipio_ciudad'],
    email:     ['email','correo','mail','correo_electronico'],
    telefono:  ['telefono','tel','celular','cel','phone','whatsapp']
};

function _pwdMasivo() {
    const p = ['Aguila','Bosque','Cielo','Delfin','Estrella','Fuente','Jardin','Lago',
               'Monte','Nube','Palma','Pinar','Roca','Sierra','Sol','Valle','Viento',
               'Cedro','Flores','Mangle','Llano','Meseta','Selva','Bahia','Canion'];
    const r = () => p[Math.floor(Math.random() * p.length)];
    const n = () => Math.floor(Math.random() * 90) + 10;
    return `${r()}${n()}${r()}${n()}`;
}

function _mapColsImport(headers) {
    const norm = headers.map(h => (h||'').toString().trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,''));
    const map = {};
    Object.entries(_COL_ALIASES).forEach(([key, aliases]) => {
        const idx = norm.findIndex(h => aliases.includes(h));
        if (idx >= 0) map[key] = idx;
    });
    return map;
}

window._importRows     = [];
window._importResultados = [];

window.descargarPlantillaImport = function() {
    const wb = XLSX.utils.book_new();

    // Hoja 1: Plantilla
    const ws = XLSX.utils.aoa_to_sheet([
        ['usuario','nombre','rol','estado','municipio','email','telefono'],
        ['JGarciaHGO','Juan García López','secretario_municipal','Hidalgo','Pachuca','juan@ejemplo.com','7711234567'],
        ['MPérezJAL','María Pérez Ruiz','coordinador_municipal','Jalisco','Guadalajara','','3311234567'],
        ['LSánchezCMX','Laura Sánchez Mora','delegado_estatal_mujeres','Ciudad de México','','lsanchez@mc.org.mx','5512345678']
    ]);
    ws['!cols'] = [{wch:18},{wch:28},{wch:32},{wch:22},{wch:22},{wch:28},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws, 'Usuarios');

    // Hoja 2: Catálogo de roles
    const wsR = XLSX.utils.aoa_to_sheet([
        ['rol (valor exacto)','Descripción'],
        ..._TODOS_ROLES_IMPORT.map(r => [r, ROLE_NAMES[r] || r])
    ]);
    wsR['!cols'] = [{wch:38},{wch:35}];
    XLSX.utils.book_append_sheet(wb, wsR, 'Roles Válidos');

    // Hoja 3: Catálogo de estados
    const wsE = XLSX.utils.aoa_to_sheet([
        ['estado (nombre completo)','Abreviatura'],
        ['Nacional',''],
        ...Object.entries(_ABBR_ESTADO)
    ]);
    wsE['!cols'] = [{wch:28},{wch:14}];
    XLSX.utils.book_append_sheet(wb, wsE, 'Estados');

    XLSX.writeFile(wb, 'Plantilla_Importacion_Usuarios.xlsx');
};

window.procesarArchivoImport = function(input) {
    const file = input.files[0];
    if (!file) return;
    const area = document.getElementById('import-preview-area');
    area.innerHTML = '<p style="text-align:center;color:#888;padding:20px;">⏳ Leyendo archivo...</p>';

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

            if (raw.length < 2) {
                area.innerHTML = '<p style="color:red;padding:15px;">⚠️ El archivo está vacío o solo tiene encabezados.</p>';
                return;
            }

            const colMap = _mapColsImport(raw[0]);
            if (colMap.usuario === undefined || colMap.nombre === undefined || colMap.rol === undefined) {
                area.innerHTML = `<p style="color:red;padding:15px;">❌ No se encontraron columnas obligatorias
                    (<strong>usuario</strong>, <strong>nombre</strong>, <strong>rol</strong>).
                    Verifica que los encabezados coincidan con la plantilla y descarga de nuevo si es necesario.</p>`;
                return;
            }

            const usuariosExistentes = new Set(
                (window.CRM.APP.users || []).map(u => (u.usuario || '').toLowerCase())
            );
            const estadosValidos = new Set([
                'Nacional',
                ...Object.keys(_ABBR_ESTADO),
                ...(window.CRM.USA_STATES || [])
            ]);
            const rows = [];

            for (let i = 1; i < raw.length; i++) {
                const r = raw[i];
                const usuario = (r[colMap.usuario] ?? '').toString().trim();
                if (!usuario) continue;   // skip empty rows

                const nombre    = (r[colMap.nombre]    ?? '').toString().trim();
                const rol       = (r[colMap.rol]       ?? '').toString().trim();
                const estado    = (r[colMap.estado]    ?? '').toString().trim();
                const municipio = colMap.municipio !== undefined ? (r[colMap.municipio] ?? '').toString().trim() : '';
                const email     = colMap.email     !== undefined ? (r[colMap.email]     ?? '').toString().trim() : '';
                const telefono  = colMap.telefono  !== undefined ? (r[colMap.telefono]  ?? '').toString().trim() : '';

                const errors = [], warnings = [];

                if (!nombre)   errors.push('Falta nombre');
                if (!rol)      errors.push('Falta rol');
                if (!estado)   errors.push('Falta estado');
                if (/\s/.test(usuario)) errors.push('El usuario no puede tener espacios');

                if (rol && !_TODOS_ROLES_IMPORT.includes(rol))
                    errors.push(`Rol no válido: "${rol}"`);

                if (estado && !estadosValidos.has(estado))
                    warnings.push(`Estado no reconocido: "${estado}"`);

                if (usuariosExistentes.has(usuario.toLowerCase()))
                    errors.push('El usuario ya existe en el sistema');

                // Nomenclature check
                let usuarioSugerido = null;
                const abbr = _ABBR_ESTADO[estado];
                if (abbr && !usuario.toUpperCase().endsWith(abbr)) {
                    usuarioSugerido = usuario + abbr;
                    warnings.push(`Sin abreviatura de estado al final (sugerido: ${usuarioSugerido})`);
                }

                const status = errors.length ? 'error' : (warnings.length ? 'warning' : 'ok');

                rows.push({
                    rowNum: i, usuario, usuarioFinal: usuario, usuarioSugerido,
                    nombre, rol, estado, municipio, email, telefono,
                    errors, warnings, status,
                    checked: status !== 'error'
                });
            }

            window._importRows = rows;
            _renderImportPreview(rows);

        } catch(err) {
            area.innerHTML = `<p style="color:red;padding:15px;">❌ Error al leer el archivo: ${err.message}</p>`;
        }
    };
    reader.readAsArrayBuffer(file);
};

function _renderImportPreview(rows) {
    const area = document.getElementById('import-preview-area');
    if (!rows.length) {
        area.innerHTML = '<p style="color:#888;padding:15px;">No se encontraron filas con datos válidos.</p>';
        return;
    }

    const cOk   = rows.filter(r => r.status === 'ok').length;
    const cWarn = rows.filter(r => r.status === 'warning').length;
    const cErr  = rows.filter(r => r.status === 'error').length;
    const cSel  = rows.filter(r => r.status !== 'error').length;

    let html = `<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
        <span style="background:#e8f5e9;color:#2e7d32;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:bold;">✅ ${cOk} listo(s)</span>
        <span style="background:#fff8e1;color:#f57f17;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:bold;">⚠️ ${cWarn} con aviso</span>
        <span style="background:#ffebee;color:#c62828;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:bold;">❌ ${cErr} con error</span>
        <span style="background:#f5f5f5;color:#555;padding:4px 12px;border-radius:20px;font-size:13px;">Total: ${rows.length} filas</span>
    </div>
    <div style="overflow-x:auto;max-height:370px;overflow-y:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead style="position:sticky;top:0;z-index:2;">
    <tr style="background:#37474f;color:#fff;">
        <th style="padding:6px 5px;"><input type="checkbox" id="import-check-all"
            onchange="window._toggleAllImport(this.checked)" title="Seleccionar todos los importables"></th>
        <th style="padding:6px 8px;">#</th>
        <th style="padding:6px 8px;min-width:130px;">Usuario</th>
        <th style="padding:6px 8px;min-width:160px;">Nombre</th>
        <th style="padding:6px 8px;min-width:140px;">Rol</th>
        <th style="padding:6px 8px;">Estado</th>
        <th style="padding:6px 8px;">Municipio</th>
        <th style="padding:6px 8px;min-width:180px;">Validación</th>
    </tr></thead><tbody>`;

    rows.forEach((row, idx) => {
        const bg = row.status === 'error' ? '#fff5f5'
                 : row.status === 'warning' ? '#fffde7' : '#f9fff9';
        const icon = row.status === 'error' ? '❌' : row.status === 'warning' ? '⚠️' : '✅';

        const userCell = row.usuarioSugerido
            ? `<input type="text" value="${row.usuarioFinal}" data-user-idx="${idx}"
                   onchange="window._importRows[${idx}].usuarioFinal=this.value"
                   style="width:120px;font-family:monospace;font-size:11px;padding:2px 4px;
                          border:1px solid #ffa000;border-radius:3px;">
               <br><span style="font-size:10px;color:#f57f17;">sugerido:
               <a href="#" onclick="window._aplicarSugerencia(${idx});return false;"
                  style="color:#1565c0;">${row.usuarioSugerido}</a></span>`
            : `<span style="font-family:monospace;">${row.usuario}</span>`;

        const msgs = [
            ...row.errors.map(e   => `<div style="color:#c62828;font-size:11px;">✗ ${e}</div>`),
            ...row.warnings.map(w => `<div style="color:#e65100;font-size:11px;">⚠ ${w}</div>`)
        ].join('');

        html += `<tr style="background:${bg};border-bottom:1px solid #eee;">
            <td style="padding:4px;text-align:center;">
                <input type="checkbox" data-cb-idx="${idx}"
                    ${row.checked ? 'checked' : ''} ${row.status === 'error' ? 'disabled' : ''}
                    onchange="window._importRows[${idx}].checked=this.checked">
            </td>
            <td style="padding:4px 8px;color:#999;">${row.rowNum}</td>
            <td style="padding:4px 8px;">${userCell}</td>
            <td style="padding:4px 8px;">${row.nombre}</td>
            <td style="padding:4px 8px;font-family:monospace;font-size:11px;">${row.rol}</td>
            <td style="padding:4px 8px;">${row.estado}</td>
            <td style="padding:4px 8px;color:#666;">${row.municipio||'—'}</td>
            <td style="padding:4px 8px;">${icon}${msgs}</td>
        </tr>`;
    });

    html += `</tbody></table></div>
    <div style="margin-top:14px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <button class="primary-btn" onclick="window.ejecutarImportMasivo()"
            style="background:#2e7d32;color:#fff;padding:10px 24px;font-size:14px;font-weight:bold;"
            ${cSel === 0 ? 'disabled' : ''}>
            🚀 Crear ${cSel} usuario(s) seleccionado(s)
        </button>
        <span style="font-size:12px;color:#777;">Se generará una contraseña temporal por usuario. Al finalizar puedes descargar la lista en Excel.</span>
    </div>`;

    area.innerHTML = html;
}

window._aplicarSugerencia = function(idx) {
    const row = window._importRows[idx];
    row.usuarioFinal = row.usuarioSugerido;
    const inp = document.querySelector(`input[data-user-idx="${idx}"]`);
    if (inp) inp.value = row.usuarioSugerido;
};

window._toggleAllImport = function(checked) {
    window._importRows.forEach((row, idx) => {
        if (row.status !== 'error') {
            row.checked = checked;
            const cb = document.querySelector(`input[data-cb-idx="${idx}"]`);
            if (cb) cb.checked = checked;
        }
    });
};

window.ejecutarImportMasivo = async function() {
    const seleccionados = window._importRows.filter(r => r.checked && r.status !== 'error');
    if (!seleccionados.length) { alert('No hay usuarios seleccionados.'); return; }
    if (!confirm(`¿Crear ${seleccionados.length} usuario(s)?\n\nSe generará una contraseña temporal para cada uno.`)) return;

    const area = document.getElementById('import-preview-area');
    area.innerHTML = `<div style="padding:20px;">
        <h4 style="margin:0 0 12px 0;">⏳ Creando usuarios…</h4>
        <div style="background:#e0e0e0;border-radius:6px;height:18px;margin-bottom:10px;">
            <div id="imp-prog-fill" style="background:#2e7d32;height:18px;border-radius:6px;width:0%;transition:width 0.3s;"></div>
        </div>
        <div id="imp-prog-txt" style="font-size:13px;color:#555;margin-bottom:18px;">0 / ${seleccionados.length}</div>
        <div id="imp-results"></div>
    </div>`;

    const resultados = [];

    for (let i = 0; i < seleccionados.length; i++) {
        const row = seleccionados[i];
        const pwd = _pwdMasivo();

        const pct = Math.round((i / seleccionados.length) * 100);
        const pFill = document.getElementById('imp-prog-fill');
        const pTxt  = document.getElementById('imp-prog-txt');
        if (pFill) pFill.style.width = pct + '%';
        if (pTxt)  pTxt.textContent  = `${i} / ${seleccionados.length} — creando: ${row.usuarioFinal}`;

        try {
            const payload = {
                usuario: row.usuarioFinal, nombre: row.nombre, rol: row.rol,
                estado: row.estado, municipio: row.municipio || '',
                email: row.email || '', telefono: row.telefono || '',
                password: pwd, force_create: true
            };
            const rp = await apiFetch(`${window.API_URL}?action=save_user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const res = await rp.json();

            if (res.status === 'success') {
                const cached = { ...payload }; delete cached.password;
                (window.CRM.APP.users = window.CRM.APP.users || []).push(cached);
                resultados.push({ usuario: row.usuarioFinal, nombre: row.nombre, rol: row.rol, estado: row.estado, pwd, ok: true });
            } else {
                resultados.push({ usuario: row.usuarioFinal, nombre: row.nombre, rol: row.rol, estado: row.estado, pwd: '—', ok: false, err: res.message });
            }
        } catch(e) {
            resultados.push({ usuario: row.usuarioFinal, nombre: row.nombre, rol: row.rol, estado: row.estado, pwd: '—', ok: false, err: e.message });
        }

        await new Promise(res => setTimeout(res, 120));  // brief pause between requests
    }

    // Final bar
    const pFillF = document.getElementById('imp-prog-fill');
    const pTxtF  = document.getElementById('imp-prog-txt');
    if (pFillF) pFillF.style.width = '100%';
    if (pTxtF)  pTxtF.textContent  = `✅ Completado — ${resultados.filter(r=>r.ok).length} creados, ${resultados.filter(r=>!r.ok).length} con error.`;

    window._importResultados = resultados;
    _renderResultadosImport(resultados);
};

function _renderResultadosImport(resultados) {
    const ok  = resultados.filter(r => r.ok);
    const err = resultados.filter(r => !r.ok);

    let html = `<hr style="border:0;border-top:1px solid #ddd;margin:16px 0;">
    <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
        <span style="background:#e8f5e9;color:#2e7d32;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:bold;">✅ ${ok.length} creados</span>
        ${err.length ? `<span style="background:#ffebee;color:#c62828;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:bold;">❌ ${err.length} con error</span>` : ''}
    </div>`;

    if (ok.length) {
        html += `<div style="overflow-x:auto;max-height:320px;overflow-y:auto;margin-bottom:12px;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#2e7d32;color:#fff;">
            <th style="padding:5px 8px;text-align:left;">Usuario</th>
            <th style="padding:5px 8px;text-align:left;">Nombre</th>
            <th style="padding:5px 8px;text-align:left;">Rol</th>
            <th style="padding:5px 8px;text-align:left;">Estado</th>
            <th style="padding:5px 8px;text-align:left;">Contraseña Temporal</th>
        </tr></thead><tbody>`;

        ok.forEach(r => {
            html += `<tr style="border-bottom:1px solid #c8e6c9;">
                <td style="padding:5px 8px;font-family:monospace;font-weight:bold;">${r.usuario}</td>
                <td style="padding:5px 8px;">${r.nombre}</td>
                <td style="padding:5px 8px;font-family:monospace;font-size:11px;">${r.rol}</td>
                <td style="padding:5px 8px;">${r.estado}</td>
                <td style="padding:5px 8px;font-family:monospace;font-size:14px;font-weight:bold;
                           letter-spacing:1px;color:#1565c0;">${r.pwd}</td>
            </tr>`;
        });

        html += `</tbody></table></div>
        <button onclick="window._exportarResultadosImport()"
            style="margin-bottom:12px;padding:9px 20px;background:#1565c0;color:#fff;
                   border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:13px;">
            📥 Descargar Excel con contraseñas
        </button>`;
    }

    if (err.length) {
        html += `<div style="background:#ffebee;border-radius:6px;padding:10px 14px;margin-top:6px;">
            <strong style="color:#c62828;">Errores:</strong>`;
        err.forEach(r => {
            html += `<p style="font-size:12px;margin:4px 0;color:#c62828;">❌ <strong>${r.usuario}</strong>: ${r.err||'Error desconocido'}</p>`;
        });
        html += `</div>`;
    }

    const el = document.getElementById('imp-results');
    if (el) el.innerHTML = html;
}

window._exportarResultadosImport = function() {
    const wb = XLSX.utils.book_new();
    const data = [
        ['Usuario','Nombre','Rol','Estado','Contraseña Temporal','Estado Importación'],
        ...(window._importResultados || []).map(r => [
            r.usuario, r.nombre, r.rol, r.estado, r.ok ? r.pwd : '—',
            r.ok ? 'Creado correctamente' : 'Error: ' + (r.err || '')
        ])
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{wch:20},{wch:30},{wch:34},{wch:22},{wch:24},{wch:35}];
    XLSX.utils.book_append_sheet(wb, ws, 'Importación');
    XLSX.writeFile(wb, `Usuarios_Importados_${new Date().toISOString().slice(0,10)}.xlsx`);
};

// ═══════════════════════════════════════════════════════════════════════════
// v15.24 — PANEL DE CONTROL DE USUARIOS
// ═══════════════════════════════════════════════════════════════════════════

// ── Helpers ──────────────────────────────────────────────────────────────

function _actividadStatus(ultimaConexion) {
    if (!ultimaConexion || ultimaConexion === '0000-00-00 00:00:00')
        return { emoji: '⚫', label: 'Sin actividad', color: '#9e9e9e', dias: null };
    const diff = (Date.now() - new Date(ultimaConexion.replace(' ', 'T'))) / 86400000;
    if (diff <= 3)   return { emoji: '🟢', label: 'Activo',    color: '#2e7d32', dias: Math.floor(diff) };
    if (diff <= 14)  return { emoji: '🟡', label: 'Reciente',  color: '#f57f17', dias: Math.floor(diff) };
    if (diff <= 60)  return { emoji: '🔴', label: 'Inactivo',  color: '#c62828', dias: Math.floor(diff) };
    return { emoji: '⚫', label: 'Dormido', color: '#616161', dias: Math.floor(diff) };
}

function _fmtFecha(ts) {
    if (!ts || ts === '0000-00-00 00:00:00') return '—';
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d)) return ts;
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Renderizador principal ────────────────────────────────────────────────

window.renderUserControlPanel = async function() {
    const el = document.getElementById('user-control-content');
    if (!el) return;
    el.innerHTML = '<p style="text-align:center;color:#888;padding:30px;">⏳ Cargando panel de control...</p>';

    try {
        const res  = await apiFetch(`${window.API_URL}?action=get_user_stats`);
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message || 'Error al cargar estadísticas');

        const stats   = data;
        const users   = window.CRM.APP.users || [];
        const alertas = stats.alertas || {};

        // ── BLOQUE ALERTAS INTELIGENTES ───────────────────────────────
        const alertItems = [];
        if (alertas.nunca_conectados > 0)
            alertItems.push(`⚫ <strong>${alertas.nunca_conectados}</strong> cuentas nunca han iniciado sesión`);
        if (alertas.inactivos_30d > 0)
            alertItems.push(`🔴 <strong>${alertas.inactivos_30d}</strong> cuentas inactivas +30 días`);
        if (alertas.bloqueados > 0)
            alertItems.push(`🔒 <strong>${alertas.bloqueados}</strong> cuentas bloqueadas actualmente`);
        if (alertas.sin_estado > 0)
            alertItems.push(`⚠️ <strong>${alertas.sin_estado}</strong> usuarios sin estado asignado`);
        if (alertas.nuevos_30d > 0)
            alertItems.push(`✅ <strong>${alertas.nuevos_30d}</strong> nuevas cuentas en los últimos 30 días`);

        const alertasHTML = alertItems.length
            ? `<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:12px 16px;margin-bottom:18px;">
                 <strong style="font-size:12px;color:#f57f17;display:block;margin-bottom:6px;">🔔 ALERTAS DEL SISTEMA</strong>
                 ${alertItems.map(a => `<div style="font-size:12px;color:#333;margin:3px 0;">• ${a}</div>`).join('')}
               </div>`
            : `<div style="background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:10px 16px;margin-bottom:18px;font-size:12px;color:#2e7d32;">
                 ✅ Sin alertas pendientes. El sistema opera con normalidad.
               </div>`;

        // ── BLOQUE TOTALES ────────────────────────────────────────────
        const maxEdo = Math.max(...(stats.por_estado || []).map(e => +e.cnt), 1);
        const barrasEdoHTML = (stats.por_estado || []).slice(0, 15).map(e => {
            const pct  = Math.round((+e.cnt / maxEdo) * 100);
            const ult  = _fmtFecha(e.ultimo);
            const edo  = e.estado || '(Sin estado)';
            return `<tr>
                <td style="padding:4px 8px;font-size:12px;white-space:nowrap;min-width:120px;">${edo}</td>
                <td style="padding:4px 8px;">
                    <div style="background:#e0e0e0;border-radius:4px;height:12px;position:relative;min-width:80px;">
                        <div style="background:#ff7e00;border-radius:4px;height:12px;width:${pct}%;"></div>
                    </div>
                </td>
                <td style="padding:4px 8px;font-size:12px;text-align:right;font-weight:bold;color:#e65100;">${e.cnt}</td>
                <td style="padding:4px 8px;font-size:11px;color:#888;">${ult}</td>
            </tr>`;
        }).join('');

        const totalesHTML = `
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
                <div style="flex:1;min-width:100px;background:#fff3e0;border-radius:8px;padding:14px;text-align:center;border:1px solid #ffcc80;">
                    <div style="font-size:26px;font-weight:bold;color:#e65100;">${stats.total}</div>
                    <div style="font-size:11px;color:#666;">Total usuarios</div>
                </div>
                <div style="flex:1;min-width:100px;background:#e3f2fd;border-radius:8px;padding:14px;text-align:center;border:1px solid #90caf9;">
                    <div style="font-size:26px;font-weight:bold;color:#1565c0;">${(stats.por_estado||[]).filter(e=>e.estado&&e.estado!=='(Sin estado)').length}</div>
                    <div style="font-size:11px;color:#666;">Estados activos</div>
                </div>
                <div style="flex:1;min-width:100px;background:#e8f5e9;border-radius:8px;padding:14px;text-align:center;border:1px solid #a5d6a7;">
                    <div style="font-size:26px;font-weight:bold;color:#2e7d32;">${alertas.nuevos_30d||0}</div>
                    <div style="font-size:11px;color:#666;">Nuevos 30 días</div>
                </div>
                <div style="flex:1;min-width:100px;background:#fce4ec;border-radius:8px;padding:14px;text-align:center;border:1px solid #f48fb1;">
                    <div style="font-size:26px;font-weight:bold;color:#c62828;">${alertas.bloqueados||0}</div>
                    <div style="font-size:11px;color:#666;">Bloqueadas</div>
                </div>
            </div>
            <div style="overflow-x:auto;border:1px solid #eee;border-radius:8px;margin-bottom:18px;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead><tr style="background:#f5f5f5;">
                        <th style="padding:6px 8px;text-align:left;color:#555;">Estado</th>
                        <th style="padding:6px 8px;text-align:left;color:#555;">Distribución</th>
                        <th style="padding:6px 8px;text-align:right;color:#555;">Usuarios</th>
                        <th style="padding:6px 8px;text-align:left;color:#555;">Último acceso</th>
                    </tr></thead>
                    <tbody>${barrasEdoHTML}</tbody>
                </table>
            </div>`;

        // ── BLOQUE TABLA DE ACTIVIDAD ─────────────────────────────────
        const searchId = 'ucpSearch_' + Date.now();
        const filterId = 'ucpFiltro_' + Date.now();
        window._ucpSearchId = searchId;
        window._ucpFiltroId = filterId;

        const filas = users.map(u => {
            const st   = _actividadStatus(u.ultima_conexion);
            const dias = st.dias !== null ? `${st.dias}d` : '—';
            const rolNom = (ROLE_NAMES[u.rol] || u.rol);
            const bloq  = u.bloqueado == 1;
            return `<tr data-usuario="${u.usuario}" data-estado="${(u.estado||'').toLowerCase()}" data-nombre="${(u.nombre||'').toLowerCase()}"
                        style="${bloq ? 'background:#fff8e1;opacity:0.75;' : ''}">
                <td style="padding:5px 8px;font-size:12px;">
                    <strong>${window.toTitleCase(u.nombre||u.usuario)}</strong><br>
                    <span style="color:#888;font-size:10px;">${u.usuario}</span>
                </td>
                <td style="padding:5px 8px;font-size:11px;color:#555;">${rolNom}</td>
                <td style="padding:5px 8px;font-size:11px;">${u.estado||'—'}</td>
                <td style="padding:5px 8px;font-size:12px;text-align:center;">
                    <span title="${u.ultima_conexion||'Sin acceso'}" style="color:${st.color};font-weight:bold;">${st.emoji} ${dias}</span>
                </td>
                <td style="padding:5px 8px;white-space:nowrap;">
                    <button onclick="window.showUserHistory('${u.usuario}')"
                        style="background:#e3f2fd;color:#1565c0;border:1px solid #90caf9;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;margin-right:3px;"
                        title="Ver historial de acciones">📋</button>
                    <button onclick="window.toggleBlockUser('${u.usuario}',${bloq ? 'false' : 'true'})"
                        style="background:${bloq ? '#e8f5e9' : '#fff3e0'};color:${bloq ? '#2e7d32' : '#e65100'};border:1px solid ${bloq ? '#a5d6a7' : '#ffcc80'};border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;"
                        title="${bloq ? 'Reactivar cuenta' : 'Suspender cuenta'}">${bloq ? '🔓 Activar' : '🔒 Suspender'}</button>
                </td>
            </tr>`;
        }).join('');

        const tablaActHTML = `
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
                <input type="text" id="${searchId}" placeholder="Buscar nombre o usuario..."
                    oninput="window._ucpFiltrar()"
                    style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:12px;flex:1;min-width:150px;">
                <select id="${filterId}" onchange="window._ucpFiltrar()"
                    style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:12px;">
                    <option value="">Todos los estados</option>
                    ${[...new Set((users).map(u=>u.estado).filter(Boolean))].sort()
                        .map(e=>`<option value="${e.toLowerCase()}">${e}</option>`).join('')}
                </select>
                <button onclick="window.iniciarBulkReset()"
                    style="background:#7b1fa2;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;white-space:nowrap;">
                    🔑 Reset Masivo de Contraseñas
                </button>
            </div>
            <div style="overflow-x:auto;border:1px solid #eee;border-radius:8px;max-height:360px;overflow-y:auto;">
                <table style="width:100%;border-collapse:collapse;" id="ucpTablaUsers">
                    <thead style="position:sticky;top:0;background:#f5f5f5;">
                        <tr>
                            <th style="padding:7px 8px;font-size:11px;text-align:left;color:#555;">Nombre / Usuario</th>
                            <th style="padding:7px 8px;font-size:11px;text-align:left;color:#555;">Rol</th>
                            <th style="padding:7px 8px;font-size:11px;text-align:left;color:#555;">Estado</th>
                            <th style="padding:7px 8px;font-size:11px;text-align:center;color:#555;">Actividad</th>
                            <th style="padding:7px 8px;font-size:11px;text-align:center;color:#555;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="ucpTbody">${filas}</tbody>
                </table>
            </div>
            <div id="ucpHistorialPanel" style="display:none;margin-top:14px;border:1px solid #e3f2fd;border-radius:8px;background:#f8fbff;padding:14px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <strong id="ucpHistorialTitulo" style="font-size:13px;color:#1565c0;">Historial</strong>
                    <button onclick="document.getElementById('ucpHistorialPanel').style.display='none'"
                        style="background:none;border:none;font-size:16px;cursor:pointer;color:#888;">×</button>
                </div>
                <div id="ucpHistorialContent" style="max-height:220px;overflow-y:auto;font-size:12px;"></div>
            </div>`;

        el.innerHTML = alertasHTML + totalesHTML + tablaActHTML;

    } catch(e) {
        el.innerHTML = `<p style="color:red;padding:20px;text-align:center;">❌ Error: ${e.message}</p>`;
    }
};

// ── Filtro en vivo de la tabla de actividad ───────────────────────────────
window._ucpFiltrar = function() {
    const txt   = (document.getElementById(window._ucpSearchId)?.value || '').toLowerCase();
    const edo   = (document.getElementById(window._ucpFiltroId)?.value || '').toLowerCase();
    const rows  = document.querySelectorAll('#ucpTbody tr[data-usuario]');
    let visible = 0;
    rows.forEach(tr => {
        const okTxt = !txt || tr.dataset.nombre.includes(txt) || tr.dataset.usuario.includes(txt);
        const okEdo = !edo || tr.dataset.estado.includes(edo);
        tr.style.display = (okTxt && okEdo) ? '' : 'none';
        if (okTxt && okEdo) visible++;
    });
};

// ── Historial por usuario ─────────────────────────────────────────────────
window.showUserHistory = async function(usuario) {
    const panel   = document.getElementById('ucpHistorialPanel');
    const titulo  = document.getElementById('ucpHistorialTitulo');
    const content = document.getElementById('ucpHistorialContent');
    if (!panel || !content) return;

    panel.style.display = 'block';
    titulo.textContent  = `📋 Historial de: ${usuario}`;
    content.innerHTML   = '<p style="color:#888;text-align:center;padding:10px;">Cargando...</p>';

    try {
        const res  = await apiFetch(`${window.API_URL}?action=get_user_history`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ usuario })
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message);

        const logs = data.logs || [];
        if (!logs.length) { content.innerHTML = '<p style="color:#aaa;text-align:center;padding:10px;">Sin acciones registradas.</p>'; return; }

        const iconMap = { login:'🔑', logout:'🚪', crear_usuario:'👤➕', editar_usuario:'✏️',
                          eliminar_usuario:'🗑️', eliminar_circulo:'🗑️⭕', reclasificar_usuario:'🔄',
                          bloquear_usuario:'🔒', desbloquear_usuario:'🔓', reset_password:'🔑' };
        let html = '<table style="width:100%;border-collapse:collapse;">';
        logs.forEach(l => {
            const ic = iconMap[l.accion] || '📋';
            html += `<tr style="border-bottom:1px solid #e8f0fe;">
                <td style="padding:4px 6px;white-space:nowrap;color:#888;font-size:10px;">${_fmtFecha(l.created_at)}</td>
                <td style="padding:4px 6px;white-space:nowrap;">${ic} ${l.accion||''}</td>
                <td style="padding:4px 6px;color:#555;">${l.objetivo||''}</td>
                <td style="padding:4px 6px;color:#999;font-size:10px;">${l.ip||''}</td>
            </tr>`;
        });
        html += '</table>';
        content.innerHTML = html;
    } catch(e) {
        content.innerHTML = `<p style="color:red;text-align:center;">Error: ${e.message}</p>`;
    }
};

// ── Bloquear / desbloquear ───────────────────────────────────────────────
window.toggleBlockUser = async function(usuario, bloquear) {
    const accion = bloquear ? 'suspender' : 'reactivar';
    if (!confirm(`¿${accion.toUpperCase()} la cuenta de "${usuario}"?\n${bloquear ? 'El usuario no podrá entrar al sistema hasta que la reactives.' : 'El usuario podrá volver a iniciar sesión.'}`)) return;

    try {
        const res  = await apiFetch(`${window.API_URL}?action=block_user`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ usuario, bloquear })
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message);
        alert(`✅ ${data.message}`);

        // Refrescar usuarios y re-renderizar
        try {
            const d2 = await window.apiFetch('load_initial_data');
            if (d2.users) window.CRM.APP.users = d2.users;
        } catch(_){}
        window.renderUserControlPanel();
    } catch(e) {
        alert(`❌ Error: ${e.message}`);
    }
};

// ── Reset masivo de contraseñas ──────────────────────────────────────────
window.iniciarBulkReset = function() {
    const users = window.CRM.APP.users || [];
    if (!users.length) return alert('No hay usuarios cargados.');

    // Construir lista de selección
    const opciones = users.filter(u => u.usuario !== (window.CRM.currentUser?.usuario))
        .map(u => {
            const st = _actividadStatus(u.ultima_conexion);
            return `<label style="display:flex;align-items:center;gap:8px;padding:5px;border-bottom:1px solid #f0f0f0;cursor:pointer;font-size:12px;">
                <input type="checkbox" class="bulk-reset-cb" value="${u.usuario}">
                <span>${window.toTitleCase(u.nombre||u.usuario)}</span>
                <span style="color:#888;font-size:10px;margin-left:auto;">${u.usuario} · ${st.emoji} ${st.label}</span>
            </label>`;
        }).join('');

    // Reutilizar un div overlay sencillo
    const overlay = document.createElement('div');
    overlay.id = 'bulkResetOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:24px;max-width:520px;width:95%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.3);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <h3 style="margin:0;color:#7b1fa2;">🔑 Reset Masivo de Contraseñas</h3>
                <button onclick="document.getElementById('bulkResetOverlay').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#888;">×</button>
            </div>
            <p style="font-size:12px;color:#666;margin:0 0 12px 0;">Selecciona los usuarios a los que deseas generar nueva contraseña temporal. Se generará automáticamente y podrás descargar la lista.</p>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button onclick="document.querySelectorAll('.bulk-reset-cb').forEach(c=>c.checked=true)"
                    style="font-size:11px;padding:4px 10px;border:1px solid #ddd;border-radius:4px;cursor:pointer;">✅ Todos</button>
                <button onclick="document.querySelectorAll('.bulk-reset-cb').forEach(c=>c.checked=false)"
                    style="font-size:11px;padding:4px 10px;border:1px solid #ddd;border-radius:4px;cursor:pointer;">☐ Ninguno</button>
            </div>
            <div style="overflow-y:auto;flex:1;border:1px solid #eee;border-radius:8px;padding:4px;margin-bottom:14px;">${opciones}</div>
            <button onclick="window._ejecutarBulkReset()"
                style="background:#7b1fa2;color:#fff;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:bold;cursor:pointer;width:100%;">
                🚀 Generar Contraseñas y Descargar Excel
            </button>
        </div>`;
    document.body.appendChild(overlay);
};

window._ejecutarBulkReset = async function() {
    const seleccionados = [...document.querySelectorAll('.bulk-reset-cb:checked')].map(c => c.value);
    if (!seleccionados.length) return alert('Selecciona al menos un usuario.');
    if (!confirm(`¿Generar nueva contraseña temporal para ${seleccionados.length} usuario(s)?\n\nLas contraseñas actuales quedarán INVALIDADAS.`)) return;

    const btn = document.querySelector('#bulkResetOverlay button:last-child');
    if (btn) { btn.textContent = '⏳ Procesando...'; btn.disabled = true; }

    try {
        const res  = await apiFetch(`${window.API_URL}?action=bulk_reset_passwords`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ usuarios: seleccionados })
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message);

        document.getElementById('bulkResetOverlay')?.remove();
        window._exportarResetXLSX(data.resultados || []);
        alert(`✅ Contraseñas generadas para ${data.resultados?.length || 0} usuario(s). Se descargó el archivo Excel con las nuevas credenciales.`);
    } catch(e) {
        if (btn) { btn.textContent = '🚀 Generar Contraseñas y Descargar Excel'; btn.disabled = false; }
        alert(`❌ Error: ${e.message}`);
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// v15.26 — MODO MANTENIMIENTO (Centro de Mando)
// ═══════════════════════════════════════════════════════════════════════════

window.renderMaintenancePanel = async function() {
    const el = document.getElementById('maintenance-panel-content');
    if (!el) return;

    // Leer estado actual
    let maint = { activo: false, modo: 'banner', mensaje: '' };
    try {
        const res  = await apiFetch(`${window.API_URL}?action=get_maintenance`);
        const data = await res.json();
        if (data.status === 'success' && data.maintenance) maint = data.maintenance;
    } catch(_) {}

    const activo  = maint.activo || false;
    const modo    = maint.modo || 'banner';
    const mensaje = maint.mensaje || '';

    el.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;">

            <!-- Tarjeta BANNER -->
            <div id="modeCardBanner" onclick="window._selectMaintenanceMode('banner')"
                style="cursor:pointer;border:2px solid ${activo && modo==='banner' ? '#ff7e00' : '#e0e0e0'};border-radius:10px;padding:14px;background:${activo && modo==='banner' ? '#fff3e0' : '#fafafa'};transition:all 0.2s;">
                <div style="font-size:22px;margin-bottom:6px;">📢</div>
                <strong style="font-size:13px;display:block;margin-bottom:4px;">Banner Informativo</strong>
                <p style="font-size:11px;color:#666;margin:0;">Muestra una barra naranja en la parte superior a todos los usuarios. <strong>No bloquea</strong> el trabajo.</p>
                <div style="margin-top:8px;font-size:11px;color:#ff7e00;font-weight:bold;">✔ Ideal para avisos pre-deploy</div>
            </div>

            <!-- Tarjeta BLOQUEO -->
            <div id="modeCardBloqueo" onclick="window._selectMaintenanceMode('bloqueo')"
                style="cursor:pointer;border:2px solid ${activo && modo==='bloqueo' ? '#b71c1c' : '#e0e0e0'};border-radius:10px;padding:14px;background:${activo && modo==='bloqueo' ? '#ffebee' : '#fafafa'};transition:all 0.2s;">
                <div style="font-size:22px;margin-bottom:6px;">🔒</div>
                <strong style="font-size:13px;display:block;margin-bottom:4px;">Bloqueo Total</strong>
                <p style="font-size:11px;color:#666;margin:0;">Muestra pantalla de mantenimiento a todos excepto Admin/Superadmin. <strong>Bloquea capturas.</strong></p>
                <div style="margin-top:8px;font-size:11px;color:#b71c1c;font-weight:bold;">⚠️ Solo para el momento exacto del deploy</div>
            </div>
        </div>

        <div style="margin-bottom:14px;">
            <label style="font-size:12px;font-weight:bold;display:block;margin-bottom:6px;">Mensaje para los usuarios:</label>
            <textarea id="maintenanceMensaje" rows="2"
                style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;resize:vertical;"
                placeholder="Ej: Actualización del sistema en proceso. Regresa en 5 minutos."
            >${mensaje}</textarea>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button id="btnActivarMaint" onclick="window.activarMantenimiento()"
                style="flex:1;padding:10px;border:none;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;
                       background:${activo ? '#e0e0e0' : '#e65100'};color:${activo ? '#999' : '#fff'};"
                ${activo ? 'disabled' : ''}>
                ${activo ? '✅ Modo activo' : '🚀 Activar Mantenimiento'}
            </button>
            <button onclick="window.desactivarMantenimiento()"
                style="flex:1;padding:10px;border:none;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;
                       background:${activo ? '#2e7d32' : '#e0e0e0'};color:${activo ? '#fff' : '#999'};"
                ${activo ? '' : 'disabled'}>
                ✅ Desactivar y Volver a Normal
            </button>
        </div>

        ${activo ? `<div style="margin-top:12px;background:${modo==='bloqueo'?'#ffebee':'#fff3e0'};border:1px solid ${modo==='bloqueo'?'#f48fb1':'#ffcc80'};border-radius:8px;padding:10px 14px;font-size:12px;color:${modo==='bloqueo'?'#b71c1c':'#e65100'};">
            ${modo==='bloqueo' ? '🔒' : '📢'} <strong>Modo ${modo} activo</strong> desde ${maint.desde || 'ahora'} — Activado por: ${maint.activado_por || '—'}
        </div>` : ''}`;

    // Guardar modo seleccionado
    window._maintenanceModoSeleccionado = activo ? modo : 'banner';
};

window._selectMaintenanceMode = function(modo) {
    window._maintenanceModoSeleccionado = modo;
    ['banner','bloqueo'].forEach(m => {
        const card = document.getElementById(`modeCard${m.charAt(0).toUpperCase()+m.slice(1)}`);
        if (!card) return;
        card.style.borderColor = m === modo ? (m==='bloqueo' ? '#b71c1c' : '#ff7e00') : '#e0e0e0';
        card.style.background  = m === modo ? (m==='bloqueo' ? '#ffebee' : '#fff3e0') : '#fafafa';
    });
};

window.activarMantenimiento = async function() {
    const modo    = window._maintenanceModoSeleccionado || 'banner';
    const mensaje = document.getElementById('maintenanceMensaje')?.value?.trim()
        || 'El sistema está en mantenimiento. Por favor regresa en unos minutos.';

    const aviso = modo === 'bloqueo'
        ? '⚠️ MODO BLOQUEO: Todos los usuarios (excepto Admin) verán la pantalla de mantenimiento y no podrán trabajar en el sistema.\n\n¿Confirmas activar el BLOQUEO TOTAL?'
        : `¿Activar el banner informativo?\n\nMensaje: "${mensaje}"`;

    if (!confirm(aviso)) return;

    try {
        const res  = await apiFetch(`${window.API_URL}?action=set_maintenance`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ activo: true, modo, mensaje })
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message);
        alert(`✅ Modo mantenimiento activado (${modo.toUpperCase()}).`);
        window.renderMaintenancePanel();
        // El admin también ve el banner (pero con botón "Desactivar")
        if (typeof window._handleMaintenanceStatus === 'function') {
            window._handleMaintenanceStatus(data.state);
        }
    } catch(e) {
        alert('❌ Error: ' + e.message);
    }
};

// Llamar al abrir Centro de Mando
window._loadMaintenancePanelOnOpen = function() {
    if (window.hasPermission('delete_items')) {
        window.renderMaintenancePanel();
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// v15.25 — PANEL DE RESCATE DE CÍRCULOS (Centro de Mando)
// ═══════════════════════════════════════════════════════════════════════════

window.renderRescateCirculos = async function() {
    const el = document.getElementById('rescate-circulos-content');
    if (!el) return;
    el.innerHTML = '<p style="text-align:center;color:#888;padding:24px;">⏳ Analizando base de datos...</p>';

    try {
        const res  = await apiFetch(`${window.API_URL}?action=get_circle_rescue`);
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch(parseErr) {
            const preview = text ? text.substring(0, 300) : '(respuesta vacía)';
            throw new Error(`El servidor devolvió una respuesta inválida:\n${preview}`);
        }
        if (data.status !== 'success') throw new Error(data.message || JSON.stringify(data));

        const { limbo, huerfanos, desplazados, resumen } = data;
        const total = resumen.limbo + resumen.huerfanos + resumen.desplazados;

        // ── Resumen de totales ────────────────────────────────────────
        const resumenHTML = `
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
                <div style="flex:1;min-width:90px;background:${resumen.limbo>0?'#fff3e0':'#f1f8e9'};border-radius:8px;padding:12px;text-align:center;border:1px solid ${resumen.limbo>0?'#ffcc80':'#c5e1a5'};">
                    <div style="font-size:22px;font-weight:bold;color:${resumen.limbo>0?'#e65100':'#558b2f'};">${resumen.limbo}</div>
                    <div style="font-size:11px;color:#666;">🌫️ En Limbo<br><span style="font-size:10px;">(sin estado)</span></div>
                </div>
                <div style="flex:1;min-width:90px;background:${resumen.huerfanos>0?'#fce4ec':'#f1f8e9'};border-radius:8px;padding:12px;text-align:center;border:1px solid ${resumen.huerfanos>0?'#f48fb1':'#c5e1a5'};">
                    <div style="font-size:22px;font-weight:bold;color:${resumen.huerfanos>0?'#c62828':'#558b2f'};">${resumen.huerfanos}</div>
                    <div style="font-size:11px;color:#666;">👻 Huérfanos<br><span style="font-size:10px;">(sin dueño)</span></div>
                </div>
                <div style="flex:1;min-width:90px;background:${resumen.desplazados>0?'#fff8e1':'#f1f8e9'};border-radius:8px;padding:12px;text-align:center;border:1px solid ${resumen.desplazados>0?'#ffe082':'#c5e1a5'};">
                    <div style="font-size:22px;font-weight:bold;color:${resumen.desplazados>0?'#f57f17':'#558b2f'};">${resumen.desplazados}</div>
                    <div style="font-size:11px;color:#666;">🔄 Desplazados<br><span style="font-size:10px;">(estado ≠ creador)</span></div>
                </div>
                <div style="flex:1;min-width:90px;background:${total>0?'#fafafa':'#e8f5e9'};border-radius:8px;padding:12px;text-align:center;border:1px solid ${total>0?'#e0e0e0':'#a5d6a7'};">
                    <div style="font-size:22px;font-weight:bold;color:${total>0?'#424242':'#2e7d32'};">${total}</div>
                    <div style="font-size:11px;color:#666;">Total<br><span style="font-size:10px;">requieren atención</span></div>
                </div>
            </div>`;

        if (total === 0) {
            el.innerHTML = resumenHTML + '<div style="text-align:center;padding:20px;background:#e8f5e9;border-radius:8px;color:#2e7d32;font-weight:bold;">✅ ¡Excelente! Todos los círculos tienen estado y dueño válido.</div>';
            return;
        }

        // ── Función para construir tabla de cada tipo ─────────────────
        const buildTable = (items, tipo) => {
            if (!items.length) return `<p style="color:#888;font-size:12px;padding:10px;text-align:center;">Sin círculos en esta categoría.</p>`;
            return `<div style="overflow-x:auto;max-height:280px;overflow-y:auto;border:1px solid #eee;border-radius:8px;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead style="position:sticky;top:0;background:#f5f5f5;">
                        <tr>
                            <th style="padding:6px 8px;text-align:left;">Círculo</th>
                            <th style="padding:6px 8px;text-align:left;">Municipio</th>
                            ${tipo==='desplazados' ? '<th style="padding:6px 8px;">Estado Círculo</th><th style="padding:6px 8px;">Estado Creador</th>' : '<th style="padding:6px 8px;">Estado</th>'}
                            <th style="padding:6px 8px;text-align:left;">Coordinador</th>
                            <th style="padding:6px 8px;text-align:center;">Integ.</th>
                            <th style="padding:6px 8px;text-align:center;">Acción</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map(c => `<tr style="border-bottom:1px solid #f0f0f0;" id="rescRow_${c.uid.replace(/[^a-z0-9]/gi,'_')}">
                            <td style="padding:5px 8px;max-width:160px;word-break:break-word;">
                                <strong style="font-size:11px;">${c.nombre||'—'}</strong>
                            </td>
                            <td style="padding:5px 8px;font-size:11px;">${c.municipio||'—'}</td>
                            ${tipo==='desplazados'
                                ? `<td style="padding:5px 8px;font-size:11px;color:#e65100;">${c.estado_acta||'—'}</td>
                                   <td style="padding:5px 8px;font-size:11px;color:#1565c0;">${c.estado_creador||'—'}</td>`
                                : `<td style="padding:5px 8px;font-size:11px;color:${c.estado_acta?'#333':'#c62828'}">${c.estado_acta||'⚠️ VACÍO'}</td>`}
                            <td style="padding:5px 8px;font-size:11px;color:${c.coordinador?'#555':'#c62828'};">${c.coordinador||'⚠️ Sin creador'}</td>
                            <td style="padding:5px 8px;text-align:center;font-weight:bold;">${c.integrantes}</td>
                            <td style="padding:5px 8px;text-align:center;">
                                <button onclick="window.abrirRescateForm('${c.uid}','${(c.nombre||'').replace(/'/g,"\\'")}','${c.coordinador||''}','${c.estado_acta||''}')"
                                    style="background:#1a237e;color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;">
                                    🩹 Corregir
                                </button>
                            </td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
        };

        // ── Pestañas de los 3 tipos ───────────────────────────────────
        el.innerHTML = resumenHTML + `
            <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
                <button id="rescTab_limbo" onclick="window._switchRescTab('limbo')"
                    style="padding:6px 14px;border-radius:20px;border:1px solid #e65100;cursor:pointer;font-size:12px;font-weight:bold;background:#e65100;color:#fff;">
                    🌫️ Limbo (${resumen.limbo})
                </button>
                <button id="rescTab_huerfanos" onclick="window._switchRescTab('huerfanos')"
                    style="padding:6px 14px;border-radius:20px;border:1px solid #ccc;cursor:pointer;font-size:12px;font-weight:bold;background:#fff;color:#555;">
                    👻 Huérfanos (${resumen.huerfanos})
                </button>
                <button id="rescTab_desplazados" onclick="window._switchRescTab('desplazados')"
                    style="padding:6px 14px;border-radius:20px;border:1px solid #ccc;cursor:pointer;font-size:12px;font-weight:bold;background:#fff;color:#555;">
                    🔄 Desplazados (${resumen.desplazados})
                </button>
            </div>
            <div id="rescContent_limbo">${buildTable(limbo,'limbo')}</div>
            <div id="rescContent_huerfanos" style="display:none;">${buildTable(huerfanos,'huerfanos')}</div>
            <div id="rescContent_desplazados" style="display:none;">${buildTable(desplazados,'desplazados')}</div>
            <div id="rescFormPanel" style="display:none;margin-top:14px;border:1px solid #e8eaf6;border-radius:8px;background:#f8f9ff;padding:16px;"></div>`;

    } catch(e) {
        el.innerHTML = `<p style="color:red;padding:20px;text-align:center;">❌ Error: ${e.message}</p>`;
    }
};

window._switchRescTab = function(tab) {
    ['limbo','huerfanos','desplazados'].forEach(t => {
        document.getElementById(`rescContent_${t}`).style.display = t === tab ? '' : 'none';
        const btn = document.getElementById(`rescTab_${t}`);
        if (btn) {
            btn.style.background = t === tab ? (t==='limbo'?'#e65100':t==='huerfanos'?'#c62828':'#f57f17') : '#fff';
            btn.style.color      = t === tab ? '#fff' : '#555';
            btn.style.borderColor= t === tab ? btn.style.background : '#ccc';
        }
    });
    document.getElementById('rescFormPanel').style.display = 'none';
};

window.abrirRescateForm = function(uid, nombre, coordActual, estadoActual) {
    const panel = document.getElementById('rescFormPanel');
    if (!panel) return;

    const users = window.CRM.APP.users || [];
    const usrOpts = users.map(u =>
        `<option value="${u.usuario}" ${u.usuario===coordActual?'selected':''}>${window.toTitleCase(u.nombre||u.usuario)} (${u.usuario}) — ${u.estado||'Sin estado'}</option>`
    ).join('');

    panel.style.display = 'block';
    panel.innerHTML = `
        <strong style="font-size:13px;color:#1a237e;">🩹 Corregir: ${nombre}</strong>
        <p style="font-size:11px;color:#666;margin:4px 0 12px;">UID: ${uid}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div>
                <label style="font-size:12px;font-weight:bold;display:block;margin-bottom:4px;">Nuevo Coordinador (usuario):</label>
                <select id="rescFormCoord" style="width:100%;padding:7px;border:1px solid #ddd;border-radius:6px;font-size:12px;">
                    <option value="">— Sin cambio —</option>
                    ${usrOpts}
                </select>
            </div>
            <div>
                <label style="font-size:12px;font-weight:bold;display:block;margin-bottom:4px;">Nuevo Estado:</label>
                <select id="rescFormEstado" style="width:100%;padding:7px;border:1px solid #ddd;border-radius:6px;font-size:12px;">
                    <option value="">— Sin cambio —</option>
                    ${(window.ESTADOS_MX_ADMIN||[]).map(e=>`<option value="${e}" ${e===estadoActual?'selected':''}>${e}</option>`).join('')}
                </select>
            </div>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
            <button onclick="document.getElementById('rescFormPanel').style.display='none'"
                style="background:#eee;color:#555;border:1px solid #ddd;border-radius:6px;padding:8px 16px;font-size:12px;cursor:pointer;">
                Cancelar
            </button>
            <button onclick="window.ejecutarRescate('${uid}')"
                style="background:#1a237e;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:12px;font-weight:bold;cursor:pointer;">
                ✅ Aplicar Corrección
            </button>
        </div>`;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.ejecutarRescate = async function(uid) {
    const nuevoCoord  = document.getElementById('rescFormCoord')?.value  || '';
    const nuevoEstado = document.getElementById('rescFormEstado')?.value || '';
    if (!nuevoCoord && !nuevoEstado) return alert('Selecciona al menos un campo a corregir.');

    try {
        const res  = await apiFetch(`${window.API_URL}?action=reassign_circle`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ uid, nuevo_coordinador: nuevoCoord, nuevo_estado: nuevoEstado })
        });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.message);
        alert('✅ ' + data.message);
        document.getElementById('rescFormPanel').style.display = 'none';
        // Refrescar el panel
        window.renderRescateCirculos();
    } catch(e) {
        alert('❌ Error: ' + e.message);
    }
};

window._exportarResetXLSX = function(resultados) {
    if (typeof XLSX === 'undefined') {
        // Fallback: CSV
        const csv = 'Usuario,Contraseña Temporal\n' +
            resultados.filter(r => r.password_temporal)
                .map(r => `${r.usuario},${r.password_temporal}`).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `Contraseñas_Temporales_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        return;
    }
    const wb = XLSX.utils.book_new();
    const usersMap = Object.fromEntries((window.CRM.APP.users||[]).map(u=>[u.usuario,u]));
    const data = [
        ['Usuario','Nombre Completo','Rol','Estado','Contraseña Temporal (entregar en mano)','Fecha de Reset'],
        ...resultados.filter(r => r.password_temporal).map(r => {
            const u = usersMap[r.usuario] || {};
            return [r.usuario, u.nombre||'', u.rol||'', u.estado||'', r.password_temporal, new Date().toLocaleDateString('es-MX')];
        })
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{wch:22},{wch:30},{wch:28},{wch:20},{wch:36},{wch:18}];
    XLSX.utils.book_append_sheet(wb, ws, 'Contraseñas');
    XLSX.writeFile(wb, `Contraseñas_Temporales_${new Date().toISOString().slice(0,10)}.xlsx`);
};
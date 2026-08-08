/**
 * auth.js
 * Gestión de Autenticación, Permisos (RBAC) y Sesión.
 * Versión: 12.0 (Sesión validada en servidor, bcrypt, logout limpio)
 */

window.CRM = window.CRM || {};
window.CRM.currentUser = null;

// Matriz de permisos de fábrica (fallback cuando el servidor no devuelve customRoles)
// Columnas: create_users | edit_users | delete_items | view_all_users | view_state_reports | view_circ_reports | centro_mando
window.DEFAULT_PERMISSIONS = {
    // ── Nivel 1: Poder Total (borrado directo) ─────────────────────────────────
    'admin':                          { create_users: true,  edit_users: true,  delete_items: true,  view_all_users: true,  view_state_reports: true,  view_circ_reports: true,  centro_mando: true  },
    'superadmin':                     { create_users: true,  edit_users: true,  delete_items: true,  view_all_users: true,  view_state_reports: true,  view_circ_reports: true,  centro_mando: true  },
    'secretario_nacional':            { create_users: true,  edit_users: true,  delete_items: true,  view_all_users: true,  view_state_reports: true,  view_circ_reports: true,  centro_mando: true  },
    // ── Nivel 2: Lectura Nacional (sin crear, editar ni borrar) ───────────────
    'coordinador_nacional':           { create_users: false, edit_users: false, delete_items: false, view_all_users: true,  view_state_reports: true,  view_circ_reports: true,  centro_mando: true  },
    // ── Nivel 3: Operativo Estatal ─────────────────────────────────────────────
    'validacion':                     { create_users: false, edit_users: false, delete_items: false, view_all_users: true,  view_state_reports: false, view_circ_reports: false, centro_mando: false },
    'secretario_estatal':             { create_users: true,  edit_users: true,  delete_items: false, view_all_users: false, view_state_reports: true,  view_circ_reports: false, centro_mando: false },
    // ── Nivel 4: Operativo Municipal ───────────────────────────────────────────
    'secretario_municipal':           { create_users: true,  edit_users: false, delete_items: false, view_all_users: false, view_state_reports: false, view_circ_reports: false, centro_mando: false },
    'delegado_estatal_jovenes':       { create_users: true,  edit_users: false, delete_items: false, view_all_users: false, view_state_reports: false, view_circ_reports: false, centro_mando: false },
    'delegado_estatal_mujeres':       { create_users: true,  edit_users: false, delete_items: false, view_all_users: false, view_state_reports: false, view_circ_reports: false, centro_mando: false },
    'delegado_estatal_trabajadores':  { create_users: true,  edit_users: false, delete_items: false, view_all_users: false, view_state_reports: false, view_circ_reports: false, centro_mando: false },
    'delegado_estatal_fundacion':     { create_users: true,  edit_users: false, delete_items: false, view_all_users: false, view_state_reports: false, view_circ_reports: false, centro_mando: false },
    'delegado_estatal_productores':   { create_users: true,  edit_users: false, delete_items: false, view_all_users: false, view_state_reports: false, view_circ_reports: false, centro_mando: false },
    'coordinador_estatal_usa':        { create_users: true,  edit_users: false, delete_items: false, view_all_users: false, view_state_reports: false, view_circ_reports: false, centro_mando: false }
};

// ====================================================================
// INICIO DE LA APLICACIÓN
// ====================================================================

document.addEventListener('DOMContentLoaded', async () => {
    const savedUser = localStorage.getItem('crm_user');

    if (savedUser) {
        // Validar que la sesión PHP sigue activa en el servidor
        const sessionOk = await checkServerSession();
        if (sessionOk) {
            window.CRM.currentUser = JSON.parse(savedUser);
            await window.loadDataFromCloud();
            showDashboard();
        } else {
            // Sesión expirada: limpiar y mostrar login
            localStorage.removeItem('crm_user');
            showLoginScreen();
        }
    } else {
        showLoginScreen();
    }

    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) btnLogout.addEventListener('click', handleLogout);
});

async function checkServerSession() {
    try {
        const res = await fetch(`${window.API_URL}?action=check_session`, {
            credentials: 'same-origin'
        });
        if (res.status === 401) return false;
        const data = await res.json();
        return data.status === 'success';
    } catch (e) {
        // Sin red — permitir acceso con caché local (modo offline)
        return true;
    }
}

function showLoginScreen() {
    const loginEl = document.getElementById('login-screen');
    const dashEl  = document.getElementById('dashboard');
    if (loginEl) loginEl.style.display = 'flex';
    if (dashEl)  dashEl.style.display  = 'none';
}

// ====================================================================
// LOGIN
// ====================================================================

async function handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('btnLogin');
    const err = document.getElementById('login-error');

    const userVal = document.getElementById('username').value.trim();
    const passVal = document.getElementById('password').value;

    if (!userVal || !passVal) {
        err.textContent = 'Ingresa usuario y contraseña.';
        return;
    }

    btn.disabled    = true;
    btn.textContent = 'Conectando al Servidor...';
    err.textContent = '';

    try {
        const response = await fetch(`${window.API_URL}?action=login`, {
            method:      'POST',
            headers:     { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body:        JSON.stringify({ usuario: userVal, password: passVal })
        });

        const data = await response.json();

        if (data.status === 'success' && data.user) {
            window.CRM.currentUser = data.user;
            // Guardar perfil (sin contraseña — el servidor ya no la envía)
            localStorage.setItem('crm_user', JSON.stringify(data.user));

            btn.textContent = 'Descargando Datos...';
            await window.loadDataFromCloud();
            showDashboard();
        } else {
            err.textContent = data.message || 'Usuario o contraseña incorrectos.';
        }
    } catch (error) {
        console.error('Error en login:', error);
        err.textContent = 'Error de conexión. Revisa tu internet.';
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Ingresar';
    }
}

// ====================================================================
// DASHBOARD
// ====================================================================

function showDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display    = 'block';

    const u          = window.CRM.currentUser;
    const profileImg = document.getElementById('headerUserImage');

    document.getElementById('welcomeMsg').innerHTML =
        `Bienvenido, <strong>${window.toTitleCase(u.nombre)}</strong><br>` +
        `<small style="color:#666;">${(u.rol || '').replace(/_/g, ' ').toUpperCase()}</small>`;

    if (u.foto) {
        profileImg.src            = u.foto;
        profileImg.style.display  = 'inline-block';
    } else {
        profileImg.style.display = 'none';
    }

    window.applyUIBasedOnPermissions();
    if (typeof window.updateStats === 'function')        window.updateStats();
    if (typeof window.checkOfflineStatus === 'function') window.checkOfflineStatus();
}

// ====================================================================
// LOGOUT
// ====================================================================

async function handleLogout() {
    try {
        await fetch(`${window.API_URL}?action=logout`, {
            method:      'POST',
            credentials: 'same-origin'
        });
    } catch (e) { /* sin red — no importa, igual limpiamos */ }

    localStorage.removeItem('crm_user');
    window.CRM.currentUser = null;
    window.location.reload();
}

// ====================================================================
// RBAC — PERMISOS
// ====================================================================

window.hasPermission = function(action) {
    const user = window.CRM.currentUser;
    if (!user) return false;

    const highPriv = ['admin', 'superadmin', 'coordinador_nacional', 'secretario_nacional'];
    if (highPriv.includes(user.rol)) return true;

    // Permisos personalizados de la nube
    const cloudPerms = window.CRM.APP?.trafficRules?.permissions || {};
    if (cloudPerms[user.rol]?.[action] !== undefined) {
        return cloudPerms[user.rol][action];
    }

    // Fallback a matriz de fábrica
    return window.DEFAULT_PERMISSIONS[user.rol]?.[action] ?? false;
};

window.applyUIBasedOnPermissions = function() {
    const permsToElements = {
        create_users:         'btnCreateUser',
        view_state_reports:   'btnReporteEstados',
        view_circ_reports:    'btnReporteCircunscripciones',
        centro_mando:         'btnRadar'
    };

    for (const [perm, elId] of Object.entries(permsToElements)) {
        const el = document.getElementById(elId);
        if (el) el.style.display = window.hasPermission(perm) ? 'inline-block' : 'none';
    }
};

// ====================================================================
// PERFIL DE USUARIO
// ====================================================================

window.openProfileModal = function() {
    const user = window.CRM.currentUser;
    if (!user) return;

    document.getElementById('profile_nombre').value   = user.nombre    || '';
    document.getElementById('profile_usuario').value  = user.usuario   || '';
    document.getElementById('profile_rol').value      = user.rol       || '';
    document.getElementById('profile_whatsapp').value = user.whatsapp  || '';
    document.getElementById('profile_password').value = '';
    document.getElementById('profile_preview').src    = user.foto || 'img/default-avatar.png';

    // Mostrar el botón de solicitud de cambio de rol
    const btnSolRol = document.getElementById('btnSolicitarRol');
    if (btnSolRol) btnSolRol.style.display = 'inline-block';

    window.openModal('modalProfile');
};

window.previewProfileImage = async function(input) {
    if (input.files && input.files[0]) {
        try {
            if (window.compressImage) {
                const base64 = await window.compressImage(input.files[0]);
                document.getElementById('profile_preview').src = base64;
            } else {
                const reader  = new FileReader();
                reader.onload = (e) => { document.getElementById('profile_preview').src = e.target.result; };
                reader.readAsDataURL(input.files[0]);
            }
        } catch (e) { alert('Error al cargar imagen.'); }
    }
};

window.handleSaveProfile = async function(e) {
    e.preventDefault();
    const btn       = e.target.querySelector('button[type="submit"]');
    btn.disabled    = true;
    btn.textContent = 'Guardando...';

    try {
        const user    = { ...window.CRM.currentUser };
        user.nombre   = document.getElementById('profile_nombre').value.trim();
        user.whatsapp = document.getElementById('profile_whatsapp').value.trim();

        const newPass = document.getElementById('profile_password').value;
        if (newPass.length > 0) user.password = newPass;

        const imgSrc = document.getElementById('profile_preview').src;
        if (imgSrc.startsWith('data:image')) user.foto = imgSrc;

        if (window.saveUserToCloud) await window.saveUserToCloud(user);

        // Actualizar referencia local (sin la contraseña)
        delete user.password;
        window.CRM.currentUser = user;
        try { localStorage.setItem('crm_user', JSON.stringify(user)); } catch (err) {}

        const welcomeEl = document.getElementById('welcomeMsg');
        if (welcomeEl) welcomeEl.textContent = `Hola, ${user.nombre.split(' ')[0]}`;
        const imgHeader = document.getElementById('headerUserImage');
        if (imgHeader) imgHeader.src = user.foto || 'img/default-avatar.png';

        alert('Perfil actualizado.');
        window.closeModal('modalProfile');

    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Guardar Cambios';
    }
};

// ====================================================================
// UTILIDADES
// ====================================================================

window.toTitleCase = function(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/(?:^|\s|["'([{])+\S/g, m => m.toUpperCase());
};

window.togglePassword = function(fieldId, icon) {
    const input = document.getElementById(fieldId);
    if (!input) return;
    if (input.type === 'password') {
        input.type      = 'text';
        icon.textContent = '🙈';
    } else {
        input.type       = 'password';
        icon.textContent = '👁️';
    }
};

// ====================================================================
// SOLICITUD DE CAMBIO DE ROL
// ====================================================================

window.openRoleRequestModal = function() {
    const user = window.CRM.currentUser;
    if (!user) return;

    // Construir lista de todos los roles disponibles (excepto el actual)
    const allRoles = [
        ...Object.keys(window.DEFAULT_PERMISSIONS),
        ...(window.CRM.APP?.customRoles?.map(r => r.value) || [])
    ].filter(r => r !== user.rol);

    const ROLE_LABELS = {
        admin: 'Admin', superadmin: 'Super Admin',
        coordinador_nacional: 'Coordinador Nacional', secretario_nacional: 'Secretario Nacional',
        validacion: 'Validación', secretario_estatal: 'Secretario Estatal',
        secretario_municipal: 'Secretario Municipal', delegado_estatal_jovenes: 'Del. Estatal Jóvenes',
        delegado_estatal_mujeres: 'Del. Estatal Mujeres', delegado_estatal_trabajadores: 'Del. Estatal Trabajadores',
        delegado_estatal_fundacion: 'Del. Estatal Fundación', coordinador_estatal_usa: 'Coord. Estatal USA'
    };

    const customRoles = window.CRM.APP?.customRoles || [];

    let opts = allRoles.map(r => {
        const label = ROLE_LABELS[r] || customRoles.find(c => c.value === r)?.label || r;
        return `<option value="${r}">${label}</option>`;
    }).join('');

    document.getElementById('rolRequest_actual').textContent =
        ROLE_LABELS[user.rol] || customRoles.find(c => c.value === user.rol)?.label || user.rol;
    document.getElementById('rolRequest_solicitado').innerHTML = opts;
    document.getElementById('rolRequest_motivo').value = '';
    document.getElementById('rolRequest_error').textContent   = '';
    document.getElementById('rolRequest_ok').textContent      = '';

    window.openModal('modalSolicitarRol');
};

window.submitRoleRequest = async function(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const errEl = document.getElementById('rolRequest_error');
    const okEl  = document.getElementById('rolRequest_ok');
    errEl.textContent = '';
    okEl.textContent  = '';

    const rolSolicitado = document.getElementById('rolRequest_solicitado').value;
    const motivo        = document.getElementById('rolRequest_motivo').value.trim();

    if (!motivo || motivo.length < 10) {
        errEl.textContent = 'Por favor explica el motivo (mínimo 10 caracteres).';
        return;
    }

    btn.disabled    = true;
    btn.textContent = 'Enviando...';

    try {
        const res = await apiFetch(`${window.API_URL}?action=request_role_change`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ rol_solicitado: rolSolicitado, motivo })
        });
        const data = await res.json();

        if (data.status === 'success') {
            okEl.textContent = '✅ ' + data.message;
            setTimeout(() => window.closeModal('modalSolicitarRol'), 2500);
        } else {
            errEl.textContent = '⚠️ ' + (data.message || 'Error al enviar solicitud.');
        }
    } catch (err) {
        errEl.textContent = 'Error de conexión: ' + err.message;
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Enviar Solicitud';
    }
};

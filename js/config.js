/**
 * config.js
 * Configuración global, constantes y estado inicial de la aplicación.
 * Versión: 2.8 (Nuevas Causas Migrantes + Corrección Metas)
 */

// Inicializamos el espacio de nombres global
window.CRM = window.CRM || {};

// ======= VERSIÓN DEL SISTEMA (fuente única de verdad) =======
window.CRM.APP_VERSION = '15.29';

window.CRM.CHANGELOG = [
    { v: '15.29', fecha: '2026-05-15', desc: 'Hardening Centro de Mando: abrirCentroMando() ahora verifica la sesión contra el servidor (check_session) antes de abrir el modal — bloquea a cualquiera que manipule window.CRM.currentUser desde la consola de desarrollador sin sesión PHP válida. Fix .htaccess: excepción para manifest.json (regla bloqueaba todos los .json incluyendo el PWA manifest, causando 28 errores "Tracking Prevention" en Edge).' },
    { v: '15.28', fecha: '2026-05-15', desc: 'Consola Administrativa Out-of-Band v1.0 (admin-console.php): acceso standalone protegido por IP whitelist + token maestro + CSRF + rate limiting. Pestañas: Estado del Sistema (health PHP/BD/disco/extensiones), Mantenimiento (banner/bloqueo + force-logout global), Usuarios (desbloqueo + reset contraseña + tabla de bloqueados), Base de Datos (estado de tablas + diagnóstico de columnas), Seguridad (intentos fallidos 24h + checklist), Auditoría (últimas 60 acciones + limpieza de logs), Anuncios globales, Emergencia (crear superadmin). Backend: ping_user ahora incluye force_logout y announcement en su respuesta. Frontend: _handleForceLogout() muestra overlay de cierre forzado; _handleAnnouncement() muestra banner de color por tipo (info/warning/success/danger). Todo registrado en audit_log.' },
    { v: '15.27', fecha: '2026-05-15', desc: 'Diagnóstico y estabilidad: (1) register_shutdown_function en api.php captura errores fatales PHP (E_ERROR, E_PARSE, E_CORE_ERROR) que no pueden atraparse con try-catch, devolviendo JSON de error en lugar de respuesta vacía. (2) renderRescateCirculos lee respuesta como texto primero y muestra preview del contenido real si el servidor no devuelve JSON válido. (3) Fix validate_credential: columna json_data → data, auto-patch para created_at en tabla circles.' },
    { v: '15.26', fecha: '2026-05-15', desc: 'Modo Mantenimiento: (1) Banner informativo — avisa a usuarios sobre trabajos en curso sin bloquear el acceso. (2) Bloqueo total — solo administradores pueden operar; el resto recibe pantalla de mantenimiento con countdown. (3) El estado se persiste en system_config y se distribuye a todos los clientes vía heartbeat (ping cada 20s), sin necesidad de recargar. (4) Panel de control en Centro de Mando con selector de modo, mensaje personalizable y botones Activar/Desactivar. (5) Admin siempre ve banner con botón "Desactivar" para emergencias. (6) Guardia global en api.php devuelve 503 en modo bloqueo para roles no-admin. Nuevas acciones API: set_maintenance, get_maintenance.' },
    { v: '15.25', fecha: '2026-05-15', desc: 'Fix visibilidad de círculos — 5 causas resueltas: (1) Comparación case-insensitive de estado en getAccessibleData() — "jalisco" ya coincide con "Jalisco". (2) Roles delegado_estatal_* ahora tienen nivel 2 estatal: ven todos los círculos de su estado, no solo los propios. (3) Al cambiar username desde el admin, los circles.coordinador_usuario se actualizan automáticamente en BD (evita huérfanos por cambio de username). (4) Nueva acción get_circle_rescue en API: devuelve Limbo (sin estado), Huérfanos (sin dueño) y Desplazados (estado ≠ creador) con análisis server-side correcto. (5) Nueva acción reassign_circle: corrige coordinador y/o estado de un círculo desde Centro de Mando. Panel 🚑 Rescate de Círculos en Centro de Mando con pestañas, tabla por tipo y formulario de corrección inline. Botón Limbo del listado redirige al nuevo panel centralizado.' },
    { v: '15.24', fecha: '2026-05-15', desc: 'Panel de Control de Usuarios en Centro de Mando: (1) Tablero de totales con tarjetas resumen (total, estados activos, nuevos 30d, bloqueadas). (2) Barras de distribución por estado con fecha del último acceso. (3) Alertas inteligentes automáticas al abrir Centro de Mando (nunca conectados, inactivos +30d, bloqueados, sin estado). (4) Tabla de actividad de todos los usuarios con estado 🟢/🟡/🔴/⚫, búsqueda y filtro por estado. (5) Historial de acciones por usuario (drill-down inline). (6) Bloqueo/desbloqueo temporal de cuentas desde el panel. (7) Reset masivo de contraseñas con selector múltiple y descarga de Excel. Backend: 4 nuevas acciones API (get_user_stats, block_user, get_user_history, bulk_reset_passwords), guardia global de cuenta bloqueada, columnas bloqueado/ultima_ip/created_at en tabla users.' },
    { v: '15.23', fecha: '2026-05-15', desc: 'Panel unificado de Solicitudes en Centro de Mando: pestaña "Cambio de Rol" y nueva pestaña "Solicitudes de Borrado" agrupadas en una sola sección con badges de conteo independientes. Cola de borrado completa: secretario_estatal puede solicitar eliminar usuario o círculo, Admin/superadmin/secretario_nacional aprueban o rechazan desde Centro de Mando. Backend: tabla deletion_requests, acciones request_deletion/get_deletion_requests/process_deletion_request. Frontend: solicitarBorrado(), cargarSolicitudesBorrado(), resolverSolicitudBorrado(), switchSolicitudTab().' },
    { v: '15.22', fecha: '2026-05-15', desc: 'Jerarquía de permisos refactorizada: (1) superadmin y secretario_nacional son el único Alto Mando con borrado directo; coordinador_nacional pasa a Nivel 2 lectura nacional (ve todo, no crea/edita/borra). (2) Nuevas constantes ROLES_CON_BORRADO y ROLES_NACIONALES_READONLY. (3) hasPermission() maneja correctamente los 3 niveles. (4) Borrar círculos ahora también requiere rol de Alto Mando en backend. (5) secretario_municipal solo puede crear invitado_especial. (6) superadmin y coordinador_nacional registrados en catálogo de roles visible (ya no son roles fantasma). (7) Matriz de Permisos agrega columna 🗑️ Borrar y el header corregido a 8 columnas reales.' },
    { v: '15.21', fecha: '2026-05-15', desc: 'Fix crítico PDF: Firma autógrafa de integrantes ya aparece en el Acta Constitutiva y en cada Cédula individual al regenerar el PDF desde el panel de administración. El bug ocurría porque al guardar el círculo la firma se convierte a archivo en servidor, y al recargar se devuelve como URL — el motor PDF solo aceptaba base64. Ahora usa loadImageSafe() igual que las fotos INE, compatible con base64 y URL.' },
    { v: '15.20', fecha: '2026-05-15', desc: 'Centro de Mando — Auditoría y correcciones de seguridad: (1) populateRolesSelect filtra el selector de rol al subconjunto que el rol del operador puede realmente asignar (usando ROLES_ASIGNABLES_POR_ROL). (2) isNationalAuth unificado con ROLES_NACIONALES_FULL en toda la vista (incluye superadmin y coordinador_nacional). (3) hasPermission() corregido — antes solo admin y secretario_nacional eran "full access", ahora reconoce los 4 roles nacionales. (4) Radar de Operadores usa apiFetch y valida con hasPermission. (5) saveTrafficRules ahora es async/await con manejo de error. (6) handleDeleteRole restaura el rol en memoria si falla la nube. (7) Matriz de permisos bloquea los 4 roles nacionales con 🔒. (8) Botón Auditoría, analítica de servidor, exportar directorio y reporte de validación visibles para todos los roles nacionales.' },
    { v: '15.19', fecha: '2026-05-12', desc: 'Mapa Territorial Choropleth: segunda vista del mapa interactivo con dos nuevas pestañas — "Por Estado" pinta cada entidad federativa en escala de naranja MC proporcional a su densidad de círculos, y "Por Municipio" hace lo mismo a nivel municipal (requiere archivo GeoJSON en servidor). Caché de capas GeoJSON para navegación rápida entre vistas. Leyenda integrada y estadísticas en tiempo real.' },
    { v: '15.18', fecha: '2026-05-12', desc: 'Importación Masiva de Usuarios: carga un Excel o CSV con cualquier número de usuarios, valida roles/estados/nomenclatura antes de crear, genera contraseña temporal por usuario, muestra tabla de resultados descargable en Excel. Plantilla descargable con catálogo de roles y estados incluidos.' },
    { v: '15.17', fecha: '2026-05-12', desc: 'Bitácora del Sistema: registro de todas las acciones (login, logout, crear/editar/eliminar usuarios y círculos) visible solo para Admin/Secretario Nacional en Centro de Mando. Ordenar Delegados: detecta y corrige duplicados de delegados estatales (máx. 1 por estado), botón "↓ Mover a Municipal" para reclasificar con un clic. Validación server-side de límite estatal al crear usuarios delegados.' },
    { v: '15.16', fecha: '2026-05-12', desc: 'Admin: botón "Generar Contraseña Temporal" al editar/crear usuario — genera clave legible (Palabra+N+Palabra+N), la muestra en panel verde con botón Copiar, se guarda hasheada en servidor.' },
    { v: '15.15', fecha: '2026-05-12', desc: 'Fix fecha/hora Acta: usa fecha local del dispositivo (no UTC) y captura la hora real de creación. Fix foto persistente entre integrantes: limpia _compressedBase64/_ineBase64/preview al avanzar. Versión visible en barra de título del CRM.' },
    { v: '15.14', fecha: '2026-05-12', desc: 'Fix "Sumar Integrante": implementado abrirAgregarIntegrante() con modo edición real — banner azul, auto-save por integrante, regreso al listado al finalizar. Fix hint barra progreso (Mín: 6).' },
    { v: '15.13', fecha: '2026-05-11', desc: 'Módulo Bitácora de Sesiones (Art. 15): registro por círculo de fecha, tipo, lugar, asistentes con quórum, acuerdos y notas. Módulo Observatorio Ciudadano (Art. 17): vista consolidada por municipio con coordinadores, semáforo de actividad y botones WA de convocatoria.' },
    { v: '15.12', fecha: '2026-05-11', desc: 'Mínimo de integrantes por Círculo Ciudadano actualizado a 6. Barra de progreso y mensajes ajustados. Validación de cierre bloqueante.' },
    { v: '15.11', fecha: '2026-05-11', desc: 'Coordinador único por Círculo: checkbox se oculta al designar uno, validación de unicidad, badge naranja en credencial individual y masiva. Credential PDF destaca COORD en naranja.' },
    { v: '15.10', fecha: '2026-05-11', desc: 'UX Cédula: títulos con pasos, barra de progreso, firma mutual-exclusiva, redes sociales, año/vigencia INE, checklist rediseñado con obligatorio destacado, campos sociales.' },
    { v: '15.9', fecha: '2026-05-11', desc: 'Sistema de Solicitudes de ROL: usuarios solicitan cambio de cargo con motivo; admin aprueba/rechaza desde Centro de Mando. ROL bloqueado en perfil de usuario.' },
    { v: '15.8', fecha: '2026-05-11', desc: 'OCR v8.2: preprocessing adaptativo (normalización percentil 5-95). Parser: filtro por palabra en nombre, exclusión de contexto fecha en sección. Eliminado vConsole.' },
    { v: '15.7', fecha: '2026-05-11', desc: 'OCR v8.1: pasos separados createWorker(null)+loadLanguage+initialize para evitar bug silencioso de Tesseract.js v4. langPath local. Mejor deteccion de errores por etapa.' },
    { v: '15.6', fecha: '2026-05-11', desc: 'OCR: configuracion cero — sin paths personalizados, blob worker default + CDN jsdelivr (ya en script-src CSP). Herramienta admin compresion masiva INE.' },
    { v: '15.5', fecha: '2026-05-11', desc: 'OCR: configuracion minima — solo workerPath personalizado, corePath y langPath usan CDN default del worker (SIMD auto-detectado, tessdata desde projectnaptha confirmado accesible)' },
    { v: '15.4', fecha: '2026-05-10', desc: 'OCR fix: langPath usa CDN tessdata.projectnaptha.com (archivo auto-hospedado se cortaba a 15%). corePath con ruta explicita .wasm.js para omitir deteccion SIMD' },
    { v: '15.3', fecha: '2026-05-10', desc: 'OCR: logger de progreso visible en UI para diagnostico. CSP: jsdelivr re-habilitado como fallback. HTML no-cache headers' },
    { v: '15.2', fecha: '2026-05-10', desc: 'OCR definitivo: tesseract.min.js auto-hospedado + workerBlobURL:false para cargar worker directamente sin blob intermediario' },
    { v: '15.1', fecha: '2026-05-10', desc: 'Fix OCR: workerPath/corePath/langPath con URL absoluta (location.origin) para compatibilidad con blob workers' },
    { v: '15.0', fecha: '2026-05-10', desc: 'OCR auto-hospedado: worker/WASM/tessdata en servidor propio. CSP simplificado sin CDNs externos. Recorte de camara en pixeles reales. Fix SetImageFile/SetVariable: langPath local' },
    { v: '14.5', fecha: '2026-05-09', desc: 'OCR: tessdata auto-hospedada en /tessdata/ para evitar bloqueo CSP. Fix manejo de errores ProgressEvent' },
    { v: '14.4', fecha: '2026-05-09', desc: 'OCR v8.0: camara con mascara INE, compresion inteligente (INE 150KB / perfil 80KB), parser SECCION anclado a etiqueta, modal de captura, badge de tamano' },
    { v: '14.3', fecha: '2026-05-07', desc: 'Fix: tarjeta Integrantes del Nacional clickable con filtro multi-rol. Fix OCR: PSM.SINGLE_BLOCK reemplazado por valor numerico 6 para compatibilidad Tesseract CDN' },
    { v: '15.0', fecha: '2026-05-07', desc: 'Orden y cambio de nombre tarjetas, Secc Electoral, Versión Login, Bug de cambio de versión' },
    { v: '14.2', fecha: '2026-05-07', desc: 'Dashboard: tarjetas justificadas full-width por fila (flex sin max-width)' },
    { v: '14.1', fecha: '2026-05-07', desc: 'Dashboard rediseñado: filas por jerarquía (Nacional, Estatal, Municipal, Delegados, Cargos). Nuevas categorías: Pres. Mpales, Senadores. Corrección caché CSS.' },
    { v: '14.0', fecha: '2026-05-07', desc: 'Catálogo completo de municipios (2,478 municipios INEGI Mar-2026). Escáner QR valida contra base de datos. Fix caché NGINX con bump de versiones.' },
    { v: '13.0', fecha: '2026-04-25', desc: 'Hardening de seguridad v12.0: CSP, HTTPS forzado, bloqueo de archivos sensibles. Leaflet auto-hospedado. Sección electoral en mapa y credenciales. Validador público validar.html.' },
    { v: '12.0', fecha: '2026-04-10', desc: 'Sesión validada en servidor con bcrypt. Logout limpio. QR en credenciales con CURP. Modal de foto iOS-safe.' },
    { v: '11.3', fecha: '2026-03-15', desc: 'Agenda Ciudadana: calendario pantalla dividida. Escáner de asistencia a eventos. Exportación PDF de estados.' },
];

// ======= Constantes del Sistema =======
window.CRM.STORAGE_KEY = "cc_crm_v6_validacion";
window.CRM.STORAGE_KEY_USER = "cc_crm_user_v6";

// ======= 1. LISTAS GEOGRÁFICAS =======

// Lista de Estados (México)
window.CRM.ESTADOS = [
    "Nacional",
    "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua", "Ciudad de México", "Coahuila",
    "Colima", "Durango", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "Estado de México", "Michoacán", "Morelos", "Nayarit",
    "Nuevo León", "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas",
    "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas"
];

// Lista de Estados (USA)
window.CRM.USA_STATES = [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Carolina del Norte", "Carolina del Sur",
    "Colorado", "Connecticut", "Dakota del Norte", "Dakota del Sur", "Delaware", "Florida", "Georgia",
    "Hawái", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Luisiana", "Maine",
    "Maryland", "Massachusetts", "Michigan", "Minnesota", "Misisipi", "Misuri", "Montana", "Nebraska",
    "Nevada", "Nueva Jersey", "Nueva York", "Nuevo Hampshire", "Nuevo México", "Ohio", "Oklahoma",
    "Oregón", "Pensilvania", "Rhode Island", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
    "Virginia Occidental", "Washington", "Washington D.C.", "Wisconsin", "Wyoming", "Puerto Rico"
];

// Circunscripciones Electorales
window.CRM.CIRCUNSCRIPCIONES = [
    "1ª Circunscripción", "2ª Circunscripción", "3ª Circunscripción", "4ª Circunscripción", "5ª Circunscripción"
];

// ======= CORRECCIÓN DE SECCIONES (INE ~68,500 Total) =======
// Base de cálculo para meta: Secciones * 2.5 = ~171,000 Círculos
window.CRM.SECCIONES_POR_ESTADO = {
    "Aguascalientes": 622,
    "Baja California": 2320,
    "Baja California Sur": 495,
    "Campeche": 540,
    "Coahuila": 1750,
    "Colima": 395,
    "Chiapas": 2150,
    "Chihuahua": 2300,
    "Ciudad de México": 5560,
    "Durango": 1220,
    "Guanajuato": 3250,
    "Guerrero": 2750,
    "Hidalgo": 1850,
    "Jalisco": 3850,
    "Estado de México": 6750,
    "Michoacán": 2700,
    "Morelos": 940,
    "Nayarit": 750,
    "Nuevo León": 2950,
    "Oaxaca": 2450,
    "Puebla": 2850,
    "Querétaro": 1050,
    "Quintana Roo": 980,
    "San Luis Potosí": 1950,
    "Sinaloa": 1850,
    "Sonora": 1650,
    "Tabasco": 1180,
    "Tamaulipas": 2150,
    "Tlaxcala": 650,
    "Veracruz": 4950,
    "Yucatán": 1150,
    "Zacatecas": 1050,
    "Nacional": 0 
};

// ======= 2. LISTAS DE NEGOCIO (Causas y Actividades) =======

window.CRM.CAUSAS = [
    "Limpieza de Bosques, baldíos, playas, ríos etc...",
    "Promover la participación ciudadana en la toma de decisiones",
    "Fortalecer la transparencia y el combate a la corrupción",
    "Defensor el Estado de Derecho y la independencia de poderes",
    "Garantizar el respeto pleno a los derechos humanos",
    "Impulsar la igualdad de género y la equidad social",
    "Proteger los derechos de la comunidad LGBTTTIQ+",
    "Acceder a una educación pública, laica y de calidad",
    "Garantizar servicios de salud universales y gratuitos",
    "Apoyar a micro, pequeñas y medianas empresas (MIPYMES)",
    "Fomentar un desarrollo económico con justicia social",
    "Proteger el medio ambiente y promover la sostenibilidad",
    "Mejorar la movilidad urbana con enfoque ecológico y seguro",
    "Implementar políticas de seguridad ciudadana no militarizadas",
    "Reformar el sistema de justicia para hacerlo más ágil y justo",
    "Proteger los derechos de niñas, niños y adolescentes",
    "Reconocer y respetar los derechos de pueblos indígenas y afrodescendientes",
    "Fortalecer la autonomía de los municipios y el federalismo",
    "Promover la cultura, la ciencia y la innovación como bienes públicos",
    "Gestión social para mi comunidad",
    "Apoyo a emprendedores y empleo local",
    "Cuidado y protección animal",
    // --- NUEVAS CAUSAS AGREGADAS ---
    "Representación política de los mexicanos en el exterior",
    "Asesoría legal",
    "Identidad, Cultura y raíces mexicanas",
    "Orientación y reinserción de mexicanos en retorno"
];

window.CRM.ACTIVIDADES_LUDICAS = [
    "Juegos y diversión", "Círculos de debate", "Círculos de Lectura", "Actividades Culturales",
    "Deporte y Activación Física", "Capacitación y emprendimiento", "Círculo de Cine",
    "Círculo de Teatro", "Círculo de Baile", "Cuidado Personal", "Gamers",
    "Clases de Cocina", "Fiestas y festividades", "Cuenta Cuentos", "Análisis Político"
];

// ======= 3. ROLES Y PERMISOS =======

window.CRM.ALL_ROLES = [
    // Roles Base
    { value: 'secretario_nacional', label: 'Secretario Nacional (Admin)' },
    { value: 'secretario_estatal', label: 'Secretario Estatal' },
    { value: 'secretario_municipal', label: 'Secretario Municipal' },
    { value: 'coordinador_distrital_federal', label: 'Coordinador Distrital Federal' },
    { value: 'coordinador_distrital_local', label: 'Coordinador Distrital Local' },
    { value: 'regidor', label: 'Regidor' },
    { value: 'sindico', label: 'Síndico' },
    { value: 'diputado_federal', label: 'Diputado Federal' },
    { value: 'diputado_local', label: 'Diputado Local' },
    { value: 'delegado_especial', label: 'Delegado Especial' },
    { value: 'invitado_especial', label: 'Invitado Especial' },
    
    // ROL DE AUDITORÍA
    { value: 'validacion', label: 'Mesa de Control (Validación)' },

    // === TITULARES NACIONALES ===
    { value: 'titular_nacional_jovenes', label: 'Titular Nacional Jóvenes' },
    { value: 'titular_nacional_mujeres', label: 'Titular Nacional Mujeres' },
    { value: 'titular_nacional_trabajadores', label: 'Titular Nacional Trabajadores' },
    { value: 'titular_nacional_fundacion', label: 'Titular Nacional Fundación Méx.' },
    { value: 'titular_nacional_migrante', label: 'Titular Nacional Movimiento Migrante' },
    { value: 'titular_nacional_productores', label: 'Titular Nacional Productores' },

    // === DELEGADOS - JÓVENES ===
    { value: 'delegado_estatal_jovenes', label: 'Delegado Estatal (Jóvenes)' },
    { value: 'delegado_municipal_jovenes', label: 'Delegado Municipal (Jóvenes)' },
    { value: 'delegado_circunscripcion_jovenes', label: 'Delegado Circunscripción (Jóvenes)' },

    // === DELEGADOS - MUJERES ===
    { value: 'delegado_estatal_mujeres', label: 'Delegada Estatal (Mujeres)' },
    { value: 'delegado_municipal_mujeres', label: 'Delegada Municipal (Mujeres)' },
    { value: 'delegado_circunscripcion_mujeres', label: 'Delegada Circunscripción (Mujeres)' },

    // === DELEGADOS - TRABAJADORES ===
    { value: 'delegado_estatal_trabajadores', label: 'Delegado Estatal (Trabajadores)' },
    { value: 'delegado_municipal_trabajadores', label: 'Delegado Municipal (Trabajadores)' },
    { value: 'delegado_circunscripcion_trabajadores', label: 'Delegado Circunscripción (Trabajadores)' },

    // === DELEGADOS - FUNDACIÓN ===
    { value: 'delegado_estatal_fundacion', label: 'Delegado Estatal (Fundación)' },
    { value: 'delegado_municipal_fundacion', label: 'Delegado Municipal (Fundación)' },
    { value: 'delegado_circunscripcion_fundacion', label: 'Delegado Circunscripción (Fundación)' },

    // === DELEGADOS - PRODUCTORES ===
    { value: 'delegado_estatal_productores', label: 'Delegado Estatal (Productores)' },
    { value: 'delegado_municipal_productores', label: 'Delegado Municipal (Productores)' },
    { value: 'delegado_circunscripcion_productores', label: 'Delegado Circunscripción (Productores)' },
    
    // === ESTRUCTURA USA (MIGRANTE) ===
    { value: 'coordinador_estatal_usa', label: 'Coordinador Estatal (USA)' }
];

// Permisos Admin Estatal
window.CRM.MANAGEABLE_ROLES_STATE_ADMIN = [
    'secretario_municipal', 'coordinador_distrital_federal', 'coordinador_distrital_local',
    'regidor', 'sindico', 'diputado_local', 'delegado_especial', 'invitado_especial'
];

// Permisos Admin Municipal
window.CRM.MANAGEABLE_ROLES_MUNICIPAL_ADMIN = [
    'delegado_especial', 'invitado_especial'
];

// === Permisos para Titulares Nacionales (Quién crea a quién) ===
window.CRM.NATIONAL_HEAD_PERMISSIONS = {
    'titular_nacional_jovenes': [
        'delegado_estatal_jovenes', 'delegado_municipal_jovenes', 'delegado_circunscripcion_jovenes'
    ],
    'titular_nacional_mujeres': [
        'delegado_estatal_mujeres', 'delegado_municipal_mujeres', 'delegado_circunscripcion_mujeres'
    ],
    'titular_nacional_trabajadores': [
        'delegado_estatal_trabajadores', 'delegado_municipal_trabajadores', 'delegado_circunscripcion_trabajadores'
    ],
    'titular_nacional_fundacion': [
        'delegado_estatal_fundacion', 'delegado_municipal_fundacion', 'delegado_circunscripcion_fundacion'
    ],
    'titular_nacional_productores': [
        'delegado_estatal_productores', 'delegado_municipal_productores', 'delegado_circunscripcion_productores'
    ],
    'titular_nacional_migrante': [
        'coordinador_estatal_usa' 
    ],
    'diputado_federal': [
        'coordinador_distrital_federal', 'coordinador_zonal', 'enlace_seccional'
    ]
};

// ======= 4. ESTADO INICIAL DE LA APLICACIÓN =======

// Inicializamos la estructura VACÍA para que api-service.js la llene desde MySQL.
// Esto evita conflictos entre LocalStorage viejo y Datos Nube nuevos.
window.CRM.APP = {
    users: [],
    circles: [],
    events: [],
    areas: []
};

// Variables de estado en memoria (Runtime)
window.CRM.currentUser = null;
window.CRM.extractedOcrText = "";
window.CRM.currentCircle = { type: null, options: [], acta: {}, cedulas: [] };
window.CRM.editingUser = null;
window.CRM._filterNacionalOnly = false;

// ======= VERSIÓN EN BARRA DE TÍTULO =======
document.addEventListener('DOMContentLoaded', function() {
    const vEl = document.getElementById('app-version-tag');
    if (vEl) vEl.textContent = 'v' + window.CRM.APP_VERSION;
});

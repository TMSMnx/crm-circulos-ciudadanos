# Manual del Sistema CRM — Círculos Ciudadanos
**Versión del sistema:** 15.29 · **Versión del manual:** 1.0 · **Fecha:** 2026-06-10  
**Cliente:** Movimiento Ciudadano  
**Desarrollado con:** Claude Code (Anthropic)

---

## Índice

1. [Resumen del proyecto](#1-resumen-del-proyecto)
2. [Estructura de archivos](#2-estructura-de-archivos)
3. [Acceso al sistema](#3-acceso-al-sistema)
4. [Módulo de Círculos Ciudadanos](#4-módulo-de-círculos-ciudadanos)
5. [Sistema de roles y permisos](#5-sistema-de-roles-y-permisos)
6. [Centro de Mando](#6-centro-de-mando)
7. [Módulos especializados](#7-módulos-especializados)
8. [Configuración del servidor](#8-configuración-del-servidor)
9. [Seguridad](#9-seguridad)
10. [Registro de cambios (Changelog)](#10-registro-de-cambios-changelog)

---

## 1. Resumen del proyecto

CRM en la nube para gestión territorial de **Círculos Ciudadanos** de Movimiento Ciudadano. Permite registrar, validar y dar seguimiento a cédulas de afiliación, generar documentos oficiales (Actas Constitutivas y Credenciales individuales) y administrar la estructura organizacional del partido a nivel nacional, estatal y municipal.

| Dato | Valor |
|---|---|
| Stack | PHP + MySQL (backend) · HTML/CSS/JS puro (frontend) |
| Arquitectura | SPA (Single Page Application) con API REST en PHP |
| Modalidad | PWA — instalable en móvil y escritorio sin app store |
| Versión actual | 15.29 (2026-05-15) |
| Base de datos | MySQL en cPanel |
| Autenticación | Sesión PHP + contraseñas bcrypt |
| OCR | Tesseract.js 4 auto-hospedado para lectura de INE |
| Generación PDF | Motor propio `pdf-engine.js` (canvas → PDF) |
| Mapas | Leaflet.js auto-hospedado |

### Objetivos del sistema
- Registrar Círculos Ciudadanos con mínimo 6 integrantes
- Capturar datos del INE por OCR o entrada manual
- Generar Acta Constitutiva y Cédulas Individuales en PDF
- Administrar la estructura por estado, municipio y rol jerárquico
- Visualizar la densidad territorial de círculos en mapa interactivo
- Soporte offline con sincronización automática al reconectarse
- Auditoría completa de todas las acciones del sistema

---

## 2. Estructura de archivos

```
public_html/
├── index.html                  ← SPA principal (dashboard + modales)
├── api.php                     ← API REST PHP (todas las acciones del CRM)
├── db.php                      ← Conexión y funciones de base de datos
├── circmast.php                ← Módulo de gestión de círculos (backend)
├── admin_compress_ine.php      ← Herramienta admin de compresión masiva INE
├── validar.html                ← Validador público de credenciales (sin login)
├── style.css                   ← Estilos globales de la aplicación
├── sw.js                       ← Service Worker (soporte offline / PWA)
├── manifest.json               ← Manifiesto PWA (íconos, nombre, colores)
├── .htaccess                   ← Seguridad, HTTPS forzado, CSP
├── version.json                ← Versión actual del sistema
├── global_config.json          ← Reglas de tráfico y roles personalizados (BD cloud)
├── php.ini                     ← Configuración PHP del servidor
│
├── js/
│   ├── config.js               ← Constantes globales, roles, estados, causas (v15.29)
│   ├── auth.js                 ← Autenticación, sesión, hasPermission()
│   ├── main.js                 ← Orquestador: event listeners, modo offline
│   ├── api-service.js          ← Capa de comunicación con api.php (apiFetch)
│   ├── circles-manager.js      ← CRUD de círculos, flujo de registro, PDF
│   ├── admin-manager.js        ← Centro de Mando, usuarios, roles, auditoría
│   ├── events-manager.js       ← Agenda ciudadana y calendario de eventos
│   ├── ocr-engine.js           ← Motor OCR para lectura de INE (Tesseract.js)
│   ├── pdf-engine.js           ← Generación de Acta Constitutiva y Cédulas PDF
│   ├── utils.js                ← Funciones auxiliares (modales, notificaciones)
│   ├── municipios.js           ← Catálogo de 2,478 municipios (INEGI Mar-2026)
│   ├── tesseract.min.js        ← Tesseract.js 4 (auto-hospedado)
│   ├── tesseract-worker.min.js ← Worker OCR
│   ├── tesseract-core.wasm.js  ← Core WASM OCR
│   └── tesseract-core.wasm     ← Binario WASM OCR
│
├── tessdata/
│   ├── spa.traineddata.gz      ← Datos de entrenamiento español (OCR)
│   └── .htaccess               ← Bloqueo de acceso directo
│
├── img/
│   ├── mc.jpeg                 ← Logo Movimiento Ciudadano
│   ├── circulos.jpg            ← Imagen de Círculos Ciudadanos
│   ├── icono-app.png           ← Ícono PWA
│   └── default-avatar.png      ← Avatar de usuario por defecto
│
└── uploads/
    └── .htaccess               ← Restricciones de acceso a archivos subidos
```

---

## 3. Acceso al sistema

### Login
- **URL:** dominio configurado (producción con HTTPS obligatorio)
- Usuario y contraseña proporcionados por el administrador del sistema
- Las contraseñas se almacenan con bcrypt (nunca en texto plano)
- La versión del sistema aparece en la pantalla de login

### Sesión
- Validada en el servidor en cada operación (`api.php` verifica la sesión PHP)
- Logout limpio que destruye la sesión en servidor y cliente
- Forzar logout global disponible desde Centro de Mando en emergencias

### Primer acceso
1. El admin crea la cuenta desde Centro de Mando → Gestión de Usuarios
2. Se genera una contraseña temporal (formato: `Palabra+N+Palabra+N`)
3. Se recomienda cambiarla desde el perfil de usuario en el primer login

---

## 4. Módulo de Círculos Ciudadanos

### Tipos de círculo

| Tipo | Descripción |
|---|---|
| **Círculo de Causas** | Orientado a causas sociales, políticas o comunitarias (26 causas disponibles) |
| **Círculo Lúdico** | Orientado a actividades recreativas y culturales (15 actividades disponibles) |

### Causas disponibles (selección)
Medio ambiente, participación ciudadana, derechos humanos, igualdad de género, LGBTTTIQ+, educación, salud, MIPYMES, seguridad ciudadana, pueblos indígenas, migrantes en retorno, y más.

### Flujo de registro de un círculo

```
1. Login → Dashboard
2. Botón "Crear Círculo" (disponible según reglas de tráfico del día)
3. Seleccionar tipo: Causas o Lúdico
4. Elegir causas o actividades
5. Completar el Acta Constitutiva:
   - Nombre del círculo, estado, municipio, sección electoral
   - Fecha y hora local del dispositivo
6. Agregar integrantes (mínimo 6):
   a. Foto de perfil (cámara o archivo)
   b. Fotografía del INE → OCR extrae nombre, CURP, sección
   c. Datos personales y firma autógrafa digital en canvas
   d. Designar un coordinador (badge naranja en credencial)
7. Generar PDF: Acta Constitutiva + Cédulas individuales
8. Guardar → sube a la nube (o queda en cola offline si no hay conexión)
```

### Datos del Acta Constitutiva
- Nombre del círculo, tipo y causas/actividades seleccionadas
- Estado, municipio, sección electoral
- Fecha y hora de constitución (tiempo local del dispositivo, no UTC)
- Firma autógrafa del coordinador en canvas

### Datos de cada integrante (Cédula)
- Foto de perfil comprimida (≤ 80 KB)
- Nombre completo, CURP
- Foto del INE anverso (comprimida ≤ 150 KB)
- Año y vigencia de la credencial INE
- Sección electoral
- Redes sociales (opcional)
- Firma autógrafa digital (canvas → base64)
- Badge naranja de COORDINADOR si corresponde

### Reglas de acceso a la creación
- Los roles de Alto Mando siempre pueden crear círculos
- Los demás usuarios dependen de las **reglas de tráfico** configuradas por el admin: qué estados y roles tienen turno cada día de la semana

---

## 5. Sistema de roles y permisos

### Nivel 1 — Alto Mando (acceso completo nacional)

| Rol | Descripción |
|---|---|
| `superadmin` | Acceso total al sistema, consola de emergencia |
| `secretario_nacional` | Admin general: borrado directo, Centro de Mando completo |
| `coordinador_nacional` | Lectura completa a nivel nacional (sin crear/editar/borrar) |

### Nivel 2 — Titulares Nacionales con área específica

| Rol | Gestiona |
|---|---|
| `titular_nacional_jovenes` | Delegados estatales, municipales y de circunscripción (Jóvenes) |
| `titular_nacional_mujeres` | Delegadas estatales, municipales y de circunscripción (Mujeres) |
| `titular_nacional_trabajadores` | Delegados de Trabajadores |
| `titular_nacional_fundacion` | Delegados Fundación México con Valores |
| `titular_nacional_productores` | Delegados Productores |
| `titular_nacional_migrante` | Coordinadores estatales USA |
| `diputado_federal` | Coordinadores distritales federales, zonales y seccionales |

### Nivel 3 — Estatales

| Rol | Capacidades |
|---|---|
| `secretario_estatal` | Ve todos los círculos de su estado. Crea usuarios de nivel 4 hacia abajo. Puede solicitar borrado al Alto Mando. |
| Delegados estatales (× 5 áreas) | Ven su estructura dentro del estado |

### Nivel 4 — Municipales y Distritales

| Rol | Capacidades |
|---|---|
| `secretario_municipal` | Solo crea `invitado_especial` |
| `coordinador_distrital_federal/local` | Gestiona su distrito |
| `regidor`, `sindico`, `diputado_local` | Acceso a su territorio |

### Nivel 5 — Roles especiales

| Rol | Función |
|---|---|
| `validacion` | Mesa de Control: valida cédulas (semáforo verde/rojo). No puede crear contenido. |
| `delegado_especial` | Rol genérico de apoyo |
| `invitado_especial` | Acceso básico, creado por nivel municipal |
| `coordinador_estatal_usa` | Estructura Migrante en EE.UU. y Puerto Rico |

### Roles personalizables (configurados en `global_config.json`)
- 100 Líderes, Consejo Nacional, Campus Naranja, Equipo Diputados Federales, Fundación México con Valores

### Permisos clave

| Acción | Quién puede |
|---|---|
| Borrar usuarios o círculos | Solo `superadmin` y `secretario_nacional` |
| Acceder a Centro de Mando | Roles nacionales + secretario_estatal (según función) |
| Ver bitácora del sistema | `superadmin` y `secretario_nacional` |
| Aprobar solicitudes de borrado | Alto Mando |
| Validar cédulas (Mesa de Control) | Rol `validacion` |
| Crear círculos | Todos (según reglas de tráfico) |

---

## 6. Centro de Mando

Accesible desde el dashboard para roles autorizados. Panel de administración completo con las siguientes pestañas:

### Gestión de Usuarios
- Tablero de totales: total, estados activos, nuevos 30d, bloqueados
- Crear, editar, bloquear y desbloquear cuentas
- Historial de acciones por usuario (drill-down inline)
- Generación de contraseña temporal con botón "Copiar"
- Reset masivo de contraseñas + descarga de Excel con credenciales
- Alertas automáticas al abrir: nunca conectados, inactivos +30d, bloqueados, sin estado

### Gestión de Círculos
- Listado filtrable por estado, municipio y rol
- 🚑 **Panel Rescate de Círculos** — tres tipos de anomalías:
  - **Limbo**: círculos sin estado asignado
  - **Huérfanos**: círculos sin coordinador
  - **Desplazados**: estado del círculo ≠ estado del creador
  - Corrección inline con reasignación de coordinador y/o estado

### Solicitudes
- **Cambio de Rol**: usuario solicita cambio de cargo → admin aprueba o rechaza
- **Solicitudes de Borrado**: secretario_estatal solicita eliminar usuario/círculo → Alto Mando decide

### Roles Personalizados
- Crear roles con etiqueta e ícono
- Solo pueden crearlos: secretario_nacional, titular_nacional, secretario_estatal

### Importación Masiva de Usuarios
- Carga un archivo Excel o CSV con N usuarios
- Validación previa de roles, estados y nomenclatura
- Generación de contraseña temporal por usuario
- Tabla de resultados descargable en Excel

### Reglas de Tráfico
- Configurar qué estados/roles pueden crear círculos en qué día de la semana

### Bitácora del Sistema
- Registro de todas las acciones: login, logout, crear/editar/borrar usuarios y círculos
- Solo visible para `superadmin` y `secretario_nacional`

### Modo Mantenimiento
- **Banner informativo** — avisa sin bloquear acceso
- **Bloqueo total** — solo admins operan; el resto ve pantalla de mantenimiento con cuenta regresiva
- El estado se distribuye a todos los clientes vía heartbeat (ping cada 20 segundos)
- El admin siempre puede desactivar desde el banner de emergencia

### Consola de Administración Fuera de Banda (`admin-console.php`)
- Acceso standalone protegido por IP whitelist + token maestro + CSRF + rate limiting
- Pestañas: Estado del Sistema · Mantenimiento · Usuarios · Base de Datos · Seguridad · Auditoría · Anuncios · Emergencia (crear superadmin)

---

## 7. Módulos especializados

### 7.1 OCR — Lectura automática de INE
- Motor: Tesseract.js 4 auto-hospedado (sin dependencias CDN externas)
- Captura desde cámara del dispositivo con máscara de recorte tipo INE
- **Compresión inteligente**: INE ≤ 150 KB · Foto perfil ≤ 80 KB
- Extrae: nombre completo, CURP, sección electoral, vigencia
- Compatible con credencial tipo E (la más reciente del INE)
- Datos extraídos pre-llenan el formulario del integrante automáticamente

### 7.2 Generación de PDF
- Motor: `js/pdf-engine.js` (canvas → jsPDF — sin servidor)
- Documentos generados:
  - **Acta Constitutiva** — datos del círculo + lista de integrantes + firma del coordinador
  - **Cédulas Individuales** — foto, datos INE, firma autógrafa, badge coordinador
- Regeneración disponible desde el panel de administración
- Firma autógrafa compatible en formato base64 (captura en tiempo real) y URL de servidor (regeneración)

### 7.3 Mapa Interactivo
- Motor: Leaflet.js auto-hospedado
- **Vista Puntual (Scatter)**: ubicación GPS de cada círculo en el mapa
- **Vista Coroplética por Estado**: densidad de círculos en escala naranja MC por entidad
- **Vista Coroplética por Municipio**: requiere archivo GeoJSON municipal en servidor
- Caché de capas GeoJSON para navegación rápida entre vistas
- Leyenda integrada con estadísticas en tiempo real

### 7.4 Agenda de Eventos
- Calendario visual con vista de mes dividida
- Crear, editar y eliminar eventos con filtro por rol y estado
- Escáner QR para registrar asistencia a eventos
- Exportación de listado en PDF

### 7.5 Reportes
- **Por Estado**: conteo de círculos, usuarios y meta (secciones INE × 2.5)
- **Por Circunscripción Electoral** (1ª a 5ª)
- Exportación a Excel y PDF
- **Observatorio Ciudadano** (Art. 17): vista consolidada por municipio con semáforo de actividad y botones WA de convocatoria

### 7.6 Bitácora de Sesiones (Art. 15)
- Registro de sesiones por círculo: fecha, tipo, lugar, asistentes, quórum, acuerdos y notas

### 7.7 Validador Público
- URL: `validar.html` — acceso sin login para cualquier persona
- Escanea el QR de una credencial impresa y verifica autenticidad contra la base de datos en tiempo real

### 7.8 Sincronización Offline
- Los círculos capturados sin internet se guardan en `localStorage` del navegador
- Banner de alerta muestra conteo de círculos en cola
- Botón "Subir Ahora" disponible al recuperar conexión
- Reporte de resultados: subidos con éxito vs. pendientes tras cada sincronización

---

## 8. Configuración del servidor

### Archivos críticos en producción
```
public_html/
  index.html, api.php, db.php, circmast.php
  validar.html, style.css, sw.js, manifest.json
  .htaccess, version.json, global_config.json, php.ini
  js/ (todos los archivos JS incluyendo Tesseract)
  tessdata/spa.traineddata.gz
  img/ (mc.jpeg, circulos.jpg, icono-app.png, default-avatar.png)
  uploads/ (carpeta vacía con .htaccess)
```

### Permisos recomendados (cPanel)
| Carpeta / Archivo | Permiso |
|---|---|
| public_html/ | 755 |
| uploads/ | 755 |
| tessdata/ | 755 |
| js/ | 755 |
| img/ | 755 |
| Archivos .php | 644 |
| Archivos .html, .js, .css | 644 |
| .htaccess | 644 |

### Credenciales de base de datos
- Almacenadas en variable de entorno del servidor (no en código fuente)
- Configurar en cPanel → Entorno → Variables de entorno, o en `.env` si el servidor lo soporta

### Bump de versión
- Ejecutar `bump-version.ps1` desde PowerShell para incrementar la versión en `version.json` y `config.js`

---

## 9. Seguridad

| Medida | Implementación |
|---|---|
| Contraseñas | bcrypt (costo factor configurable) |
| HTTPS | Forzado vía `.htaccess` — redirige todo HTTP a HTTPS |
| CSP | Content Security Policy estricta en encabezados HTTP |
| Sesión | Validada en servidor en cada llamada a `api.php` |
| Credenciales BD | Variable de entorno externo (no en código) |
| Rate limiting | En acciones sensibles (login, API) |
| CSRF | Tokens en formularios y acciones críticas |
| Auditoría | Tabla `audit_log` — todas las acciones del sistema |
| Bloqueo de cuentas | Tras N intentos fallidos; desbloqueo desde Centro de Mando |
| Logout forzado global | Desde Centro de Mando; se distribuye vía heartbeat |
| Admin Console | Protegida por IP whitelist + token maestro separado |
| uploads/ | `.htaccess` bloquea ejecución de scripts subidos |
| tessdata/ | `.htaccess` bloquea acceso HTTP directo al modelo OCR |

---

## 10. Registro de cambios (Changelog)

### v15.29 — 2026-05-15 (actual)
- Hardening Centro de Mando: verificación server-side de sesión antes de abrir (`check_session`)
- Fix `.htaccess`: excepción para `manifest.json` (bloqueaba el PWA manifest, causando 28 errores "Tracking Prevention" en Edge)

### v15.28 — 2026-05-15
- Consola Administrativa Out-of-Band (`admin-console.php`) v1.0
- Pestañas: Estado del Sistema, Mantenimiento, Usuarios, Base de Datos, Seguridad, Auditoría, Anuncios, Emergencia

### v15.27 — 2026-05-15
- Diagnóstico y estabilidad: `register_shutdown_function` captura errores fatales PHP; fix columna `json_data → data` en `validate_credential`

### v15.26 — 2026-05-15
- Modo Mantenimiento: banner informativo y bloqueo total distribuido por heartbeat (ping 20s)

### v15.25 — 2026-05-15
- Fix visibilidad de círculos (5 causas): comparación case-insensitive de estado, delegados estatales nivel 2, Panel Rescate de Círculos

### v15.24 — 2026-05-15
- Panel de Control de Usuarios en Centro de Mando: tablero, distribución por estado, alertas inteligentes, bloqueo/desbloqueo, reset masivo de contraseñas

### v15.23 — 2026-05-15
- Panel unificado de Solicitudes: cola de Cambio de Rol y cola de Borrado en Centro de Mando

### v15.22 — 2026-05-15
- Jerarquía refactorizada: solo superadmin y secretario_nacional con borrado directo; coordinador_nacional a lectura nacional

### v15.21 — 2026-05-15
- Fix crítico PDF: firma autógrafa aparece en Acta y Cédulas individuales al regenerar desde el panel (fix: base64 vs URL)

### v15.20 — 2026-05-15
- Centro de Mando — Auditoría: selección de roles filtrada por permisos del operador; hasPermission() corregido

### v15.19 — 2026-05-12
- Mapa Choropleth: vista por estado y por municipio con escala de densidad naranja MC

### v15.18 — 2026-05-12
- Importación Masiva de Usuarios desde Excel/CSV con validación previa y contraseñas temporales

### v15.17 — 2026-05-12
- Bitácora del Sistema completa; Corrector de Delegados duplicados

### v15.13 — 2026-05-11
- Módulo Bitácora de Sesiones (Art. 15) y Observatorio Ciudadano (Art. 17)

### v15.12 — 2026-05-11
- Mínimo de integrantes actualizado a 6; barra de progreso ajustada

### v15.9 — 2026-05-11
- Sistema de Solicitudes de ROL con aprobación/rechazo desde Centro de Mando

### v14.4 — 2026-05-09
- OCR v8.0: cámara con máscara INE, compresión inteligente, parser mejorado

### v14.0 — 2026-05-07
- Catálogo completo de 2,478 municipios (INEGI Mar-2026); escáner QR valida contra BD

### v13.0 — 2026-04-25
- Hardening v12.0: CSP, HTTPS forzado, bloqueo de archivos sensibles; Leaflet auto-hospedado; Validador público

### v12.0 — 2026-04-10
- Sesión validada en servidor con bcrypt; logout limpio; QR en credenciales con CURP; modal foto iOS-safe

### v11.3 — 2026-03-15
- Agenda Ciudadana: calendario pantalla dividida; escáner de asistencia a eventos

---

*Manual generado con Claude Code (Anthropic) · Movimiento Ciudadano · 2026*

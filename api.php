<?php
/**
 * api.php
 * Backend Central - Versión 12.0 (Hardened Security)
 */

// ====================================================================
// 1. CONFIGURACIÓN DEL ENTORNO
// ====================================================================
error_reporting(0);
ini_set('display_errors', 0);
ini_set('memory_limit', '512M');
ini_set('max_execution_time', 300);
ini_set('post_max_size', '50M');
ini_set('upload_max_filesize', '50M');

ob_start();

// Captura de errores fatales (E_ERROR, E_PARSE, E_CORE_ERROR) que no pueden
// atraparse con try-catch. Sin esto, PHP termina silenciosamente → respuesta vacía.
register_shutdown_function(function() {
    $error = error_get_last();
    if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR])) {
        if (ob_get_length()) ob_clean();
        http_response_code(500);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode([
            'status'  => 'error',
            'message' => 'Error fatal del servidor: ' . $error['message'],
            'file'    => basename($error['file']),
            'line'    => $error['line'],
        ]);
    }
});

// Configuración de sesión segura antes de session_start()
ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_samesite', 'Strict');
ini_set('session.use_strict_mode', 1);
if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
    ini_set('session.cookie_secure', 1);
}

session_start();

// CORS: solo mismo origen
$allowedOrigin = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http')
    . '://' . ($_SERVER['HTTP_HOST'] ?? '');

$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($requestOrigin === $allowedOrigin) {
    header("Access-Control-Allow-Origin: $allowedOrigin");
    header("Access-Control-Allow-Credentials: true");
} else {
    header("Access-Control-Allow-Origin: $allowedOrigin");
}

header("Access-Control-Allow-Headers: Content-Type");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Content-Type: application/json; charset=UTF-8");
header("X-Content-Type-Options: nosniff");
header("X-Frame-Options: DENY");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? "https://" : "http://";
$domainName = $_SERVER['HTTP_HOST'] ?? '';
$baseDir = str_replace(basename($_SERVER['SCRIPT_NAME'] ?? ''), '', $_SERVER['SCRIPT_NAME'] ?? '/');
$BASE_URL = $protocol . $domainName . $baseDir;

// ====================================================================
// 2. CONEXIÓN A BASE DE DATOS
// ====================================================================
$pdo = null;
if (file_exists('db.php')) {
    require_once 'db.php';
} else {
    limpiarYResponder(['status' => 'error', 'message' => 'Configuración de BD no encontrada'], 500);
}

// Auto-parche silencioso
try { $pdo->exec("ALTER TABLE users ADD multiestatal TINYINT(1) DEFAULT 0 AFTER estado"); } catch(Exception $e) {}
try { $pdo->exec("ALTER TABLE users ADD COLUMN bloqueado TINYINT(1) NOT NULL DEFAULT 0"); } catch(Exception $e) {}
try { $pdo->exec("ALTER TABLE users ADD COLUMN ultima_ip VARCHAR(45) DEFAULT '' AFTER ultima_conexion"); } catch(Exception $e) {}
try { $pdo->exec("ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"); } catch(Exception $e) {}
// Auto-parche tabla circles — columnas añadidas después de la versión inicial
try { $pdo->exec("ALTER TABLE circles ADD COLUMN coordinador_usuario VARCHAR(100) DEFAULT '' AFTER unique_id"); } catch(Exception $e) {}
try { $pdo->exec("ALTER TABLE circles ADD COLUMN estado_circulo VARCHAR(100) DEFAULT '' AFTER coordinador_usuario"); } catch(Exception $e) {}
try { $pdo->exec("ALTER TABLE circles ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER estado_circulo"); } catch(Exception $e) {}
// Sincronizar estado_circulo desde el JSON data para filas que ya existían sin esa columna
try {
    $pdo->exec("UPDATE circles SET estado_circulo = JSON_UNQUOTE(JSON_EXTRACT(data, '$.acta.estado'))
                WHERE (estado_circulo IS NULL OR estado_circulo = '')
                  AND JSON_EXTRACT(data, '$.acta.estado') IS NOT NULL");
} catch(Exception $e) {}
try {
    $pdo->exec("UPDATE circles SET coordinador_usuario = JSON_UNQUOTE(JSON_EXTRACT(data, '$.coordinador_usuario'))
                WHERE (coordinador_usuario IS NULL OR coordinador_usuario = '')
                  AND JSON_EXTRACT(data, '$.coordinador_usuario') IS NOT NULL");
} catch(Exception $e) {}
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS system_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        config_key VARCHAR(50) UNIQUE,
        config_value LONGTEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
} catch(Exception $e) {}

try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        actor VARCHAR(100) NOT NULL,
        accion VARCHAR(100) NOT NULL,
        objetivo VARCHAR(200) DEFAULT '',
        detalle TEXT DEFAULT '',
        ip VARCHAR(45) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_actor (actor),
        INDEX idx_accion (accion),
        INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
} catch(Exception $e) {}

try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS role_change_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        usuario VARCHAR(100) NOT NULL,
        nombre VARCHAR(200),
        rol_actual VARCHAR(100) NOT NULL,
        rol_solicitado VARCHAR(100) NOT NULL,
        motivo TEXT,
        estado ENUM('pendiente','aprobado','rechazado') DEFAULT 'pendiente',
        resuelto_por VARCHAR(100),
        resolucion_nota TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
} catch(Exception $e) {}

try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS deletion_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        solicitante VARCHAR(100) NOT NULL,
        solicitante_nombre VARCHAR(200),
        solicitante_rol VARCHAR(100),
        tipo ENUM('usuario','circulo') NOT NULL,
        target_id VARCHAR(200) NOT NULL,
        target_nombre VARCHAR(300),
        motivo TEXT,
        estado ENUM('pendiente','aprobado','rechazado') DEFAULT 'pendiente',
        resuelto_por VARCHAR(100),
        resolucion_nota TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
} catch(Exception $e) {}

// ====================================================================
// 3. PROCESAR ENTRADA
// ====================================================================
$input  = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $_GET['action'] ?? '';
$CONFIG_FILE = 'global_config.json';

// ====================================================================
// 4. FUNCIONES DE SEGURIDAD
// ====================================================================

function limpiarYResponder($data, $code = 200) {
    if (ob_get_length()) ob_clean();
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function requireAuth() {
    if (empty($_SESSION['is_logged_in']) || empty($_SESSION['usuario'])) {
        limpiarYResponder(['status' => 'error', 'message' => 'Sesión inválida. Por favor inicia sesión.'], 401);
    }
}

function requireRole(array $allowedRoles) {
    requireAuth();
    $rol = $_SESSION['rol'] ?? '';
    if (!in_array($rol, $allowedRoles, true)) {
        limpiarYResponder(['status' => 'error', 'message' => 'Acceso no autorizado para tu rol.'], 403);
    }
}

function sanitizeUsers(array $users): array {
    return array_map(function($u) {
        unset($u['password']);
        return $u;
    }, $users);
}

function getClientIP(): string {
    $fwd = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if ($fwd) return trim(explode(',', $fwd)[0]);
    return $_SERVER['REMOTE_ADDR'] ?? 'desconocida';
}

function logAction(PDO $pdo, string $actor, string $accion, string $objetivo = '', string $detalle = ''): void {
    try {
        $ip = getClientIP();
        $pdo->prepare("INSERT INTO audit_log (actor, accion, objetivo, detalle, ip) VALUES (?, ?, ?, ?, ?)")
            ->execute([$actor, $accion, $objetivo, $detalle, $ip]);
    } catch (Exception $e) { /* silencioso */ }
}

/**
 * Verifica la contraseña y migra automáticamente de texto plano a bcrypt.
 * Retorna true si las credenciales son válidas.
 */
function verifyAndMigrate(PDO $pdo, string $plain, string $stored, string $username): bool {
    // Primero intentar bcrypt (camino normal)
    if (password_verify($plain, $stored)) {
        if (password_needs_rehash($stored, PASSWORD_BCRYPT, ['cost' => 12])) {
            $hash = password_hash($plain, PASSWORD_BCRYPT, ['cost' => 12]);
            $pdo->prepare("UPDATE users SET password = ? WHERE usuario = ?")->execute([$hash, $username]);
        }
        return true;
    }
    // Migración desde texto plano legacy
    if ($plain === $stored && strlen($stored) < 60) {
        $hash = password_hash($plain, PASSWORD_BCRYPT, ['cost' => 12]);
        $pdo->prepare("UPDATE users SET password = ? WHERE usuario = ?")->execute([$hash, $username]);
        return true;
    }
    return false;
}

// ====================================================================
// 5. LOGIN
// ====================================================================
if ($action === 'login') {
    $usr = trim($input['usuario'] ?? '');
    $pwd = $input['password'] ?? '';

    if (!$usr || !$pwd) {
        limpiarYResponder(['status' => 'error', 'message' => 'Credenciales incompletas.'], 400);
    }

    // Rate limiting por IP + usuario en base de datos (resiste cambio de sesión/incógnito)
    $ip        = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $ipKey     = md5($ip . $usr);
    $now       = time();
    $ventana   = 900; // 15 minutos
    $maxIntentos = 5;

    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS login_attempts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ip_key VARCHAR(64) NOT NULL,
            locked_until INT DEFAULT 0,
            attempts INT DEFAULT 0,
            last_attempt INT DEFAULT 0,
            INDEX idx_ip_key (ip_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
    } catch(Exception $e) {}

    try {
        $stmtRL = $pdo->prepare("SELECT attempts, locked_until, last_attempt FROM login_attempts WHERE ip_key = ? LIMIT 1");
        $stmtRL->execute([$ipKey]);
        $rl = $stmtRL->fetch();

        if ($rl) {
            // Si la ventana de tiempo expiró, reiniciar contador
            if ($rl['last_attempt'] < ($now - $ventana)) {
                $pdo->prepare("UPDATE login_attempts SET attempts=0, locked_until=0 WHERE ip_key=?")->execute([$ipKey]);
                $rl['attempts']    = 0;
                $rl['locked_until'] = 0;
            }
            if ($rl['locked_until'] > $now) {
                $wait = ceil(($rl['locked_until'] - $now) / 60);
                limpiarYResponder(['status' => 'error', 'message' => "Demasiados intentos fallidos. Intenta en $wait min."], 429);
            }
        }
    } catch(Exception $e) {}

    try {
        $stmt = $pdo->prepare("SELECT id, usuario, nombre, rol, estado, multiestatal, municipio, distrito, circunscripcion, whatsapp, foto, password FROM users WHERE usuario = ? LIMIT 1");
        $stmt->execute([$usr]);
        $userData = $stmt->fetch();

        if ($userData && verifyAndMigrate($pdo, $pwd, $userData['password'], $usr)) {
            // Credenciales correctas: limpiar contador y regenerar sesión
            try {
                $pdo->prepare("DELETE FROM login_attempts WHERE ip_key = ?")->execute([$ipKey]);
            } catch(Exception $e) {}
            session_regenerate_id(true);

            $pdo->prepare("UPDATE users SET ultima_conexion = NOW(), ultima_ip = ? WHERE usuario = ?")->execute([getClientIP(), $usr]);

            $_SESSION['is_logged_in'] = true;
            $_SESSION['usuario']      = $userData['usuario'];
            $_SESSION['rol']          = $userData['rol'];
            $_SESSION['estado']       = $userData['estado'] ?? '';

            logAction($pdo, $userData['usuario'], 'login', '', 'Inicio de sesión | Rol: ' . $userData['rol']);

            unset($userData['password']);
            limpiarYResponder(['status' => 'success', 'user' => $userData]);
        } else {
            // Credenciales incorrectas: incrementar contador en BD
            try {
                $newAttempts = ($rl['attempts'] ?? 0) + 1;
                $locked = ($newAttempts >= $maxIntentos) ? ($now + $ventana) : 0;
                $pdo->prepare("INSERT INTO login_attempts (ip_key, attempts, locked_until, last_attempt)
                    VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE
                    attempts=?, locked_until=?, last_attempt=?")
                    ->execute([$ipKey, $newAttempts, $locked, $now, $newAttempts, $locked, $now]);
                if ($locked > 0) {
                    limpiarYResponder(['status' => 'error', 'message' => 'Demasiados intentos fallidos. Cuenta bloqueada 15 min.'], 429);
                }
            } catch(Exception $e) {}
            limpiarYResponder(['status' => 'error', 'message' => 'Usuario o contraseña incorrectos.'], 401);
        }
    } catch (Exception $e) {
        limpiarYResponder(['status' => 'error', 'message' => 'Error interno del servidor.'], 500);
    }
}

// ====================================================================
// 6. LOGOUT
// ====================================================================
if ($action === 'logout') {
    $actor = $_SESSION['usuario'] ?? 'desconocido';
    logAction($pdo, $actor, 'logout', '', 'Cierre de sesión');
    $_SESSION = [];
    session_destroy();
    limpiarYResponder(['status' => 'success']);
}

// ====================================================================
// 7. VERIFICAR SESIÓN ACTIVA
// ====================================================================
if ($action === 'check_session') {
    if (!empty($_SESSION['is_logged_in']) && !empty($_SESSION['usuario'])) {
        limpiarYResponder(['status' => 'success', 'usuario' => $_SESSION['usuario'], 'rol' => $_SESSION['rol']]);
    } else {
        limpiarYResponder(['status' => 'error', 'message' => 'Sin sesión activa.'], 401);
    }
}

// ====================================================================
// 7a. MODO MANTENIMIENTO — v15.26
// ====================================================================
// Función auxiliar para leer el estado de mantenimiento de system_config
function getMaintenanceStatus(PDO $pdo): array {
    try {
        $s = $pdo->prepare("SELECT config_value FROM system_config WHERE config_key = 'maintenance' LIMIT 1");
        $s->execute();
        $row = $s->fetch(PDO::FETCH_ASSOC);
        if ($row && !empty($row['config_value'])) {
            $m = json_decode($row['config_value'], true);
            if (is_array($m)) return $m;
        }
    } catch(Exception $e) {}
    return ['activo' => false];
}

$_maintenanceStatus = getMaintenanceStatus($pdo);

// En modo bloqueo: los usuarios no-admin reciben respuesta de mantenimiento
// (excepto login, logout, check_session que ya terminaron antes de llegar aquí)
if (!empty($_maintenanceStatus['activo']) && ($_maintenanceStatus['modo'] ?? '') === 'bloqueo') {
    $rolSesionMaint = $_SESSION['rol'] ?? '';
    $esAdminMaint   = in_array($rolSesionMaint, ['admin', 'superadmin', 'secretario_nacional']);
    if (!$esAdminMaint && !empty($_SESSION['is_logged_in'])) {
        limpiarYResponder([
            'status'      => 'maintenance',
            'message'     => $_maintenanceStatus['mensaje'] ?? 'El sistema está en mantenimiento. Por favor regresa en unos minutos.',
            'maintenance' => $_maintenanceStatus
        ], 503);
    }
}

// ====================================================================
// 7b. GUARDIA GLOBAL — CUENTA BLOQUEADA
// ====================================================================
// Para acciones autenticadas: verificar que la cuenta no esté suspendida.
// No aplica a login/logout/check_session (ya terminaron antes de llegar aquí).
if (!empty($_SESSION['is_logged_in']) && !empty($_SESSION['usuario'])) {
    try {
        $blStmt = $pdo->prepare("SELECT bloqueado FROM users WHERE usuario = ? LIMIT 1");
        $blStmt->execute([$_SESSION['usuario']]);
        $blRow = $blStmt->fetch(PDO::FETCH_ASSOC);
        if ($blRow && !empty($blRow['bloqueado'])) {
            $_SESSION = [];
            session_destroy();
            limpiarYResponder(['status' => 'error', 'message' => 'Tu cuenta ha sido suspendida temporalmente. Contacta al administrador.'], 403);
        }
    } catch(Exception $e) {}
}

// ====================================================================
// 8. RUTAS GET (LECTURA) — REQUIEREN AUTENTICACIÓN
// ====================================================================

if ($action === 'load_initial_data') {
    requireAuth();
    try {
        $rolSesion    = $_SESSION['rol']    ?? '';
        $estadoSesion = $_SESSION['estado'] ?? '';

        // ── Tier 1: visibilidad nacional completa ──────────────────────────
        // admin y secretario_nacional ya se validan en requireAuth/hasPermission.
        // Aquí se suman los Titulares Nacionales y el rol de validación/auditoría.
        $ROLES_NACIONALES = [
            'admin', 'secretario_nacional', 'validacion',
            'titular_nacional_jovenes',     'titular_nacional_mujeres',
            'titular_nacional_trabajadores','titular_nacional_fundacion',
            'titular_nacional_migrante',    'titular_nacional_productores',
        ];

        // ── Tier 2: visibilidad estatal (su estado + roles nacionales) ─────
        $ROLES_ESTATALES = [
            'secretario_estatal',
            'delegado_estatal_jovenes',       'delegado_estatal_mujeres',
            'delegado_estatal_trabajadores',  'delegado_estatal_fundacion',
            'delegado_estatal_productores',   'coordinador_estatal_usa',
        ];

        // Placeholder de roles nacionales para las sub-queries (IN clause)
        $ROLES_NAC_SQL = "'admin','secretario_nacional','titular_nacional_jovenes',
                          'titular_nacional_mujeres','titular_nacional_trabajadores',
                          'titular_nacional_fundacion','titular_nacional_migrante',
                          'titular_nacional_productores','validacion'";

        if (in_array($rolSesion, $ROLES_NACIONALES)) {
            // ── Tier 1: padrón completo, todos los campos ──────────────────
            $stmt = $pdo->query(
                "SELECT id, usuario, nombre, rol, estado, multiestatal, municipio,
                        distrito, circunscripcion, whatsapp, foto, ultima_conexion
                 FROM users ORDER BY estado, rol"
            );
        } elseif (in_array($rolSesion, $ROLES_ESTATALES)) {
            // ── Tier 2: su estado + roles nacionales; sin foto de terceros ─
            $stmt = $pdo->prepare(
                "SELECT usuario, nombre, rol, estado, municipio, whatsapp, ultima_conexion
                 FROM users
                 WHERE estado = ? OR rol IN ($ROLES_NAC_SQL)
                 ORDER BY rol"
            );
            $stmt->execute([$estadoSesion]);
        } else {
            // ── Tier 3: rol municipal/local — solo su propio estado ─────────
            // Sin whatsapp ni foto de otros usuarios (privacidad)
            $stmt = $pdo->prepare(
                "SELECT usuario, nombre, rol, estado, municipio, ultima_conexion
                 FROM users
                 WHERE estado = ? OR rol IN ($ROLES_NAC_SQL)
                 ORDER BY rol"
            );
            $stmt->execute([$estadoSesion]);
        }

        $users = sanitizeUsers($stmt->fetchAll());

        $customRoles  = [];
        $trafficRules = [];
        $loadedFromDb = false;

        try {
            $stmtC = $pdo->query("SELECT config_value FROM system_config WHERE config_key = 'global'");
            if ($stmtC) {
                $rowC = $stmtC->fetch();
                if ($rowC && !empty($rowC['config_value'])) {
                    $conf = json_decode($rowC['config_value'], true);
                    $customRoles  = $conf['customRoles']  ?? [];
                    $trafficRules = $conf['trafficRules'] ?? [];
                    $loadedFromDb = true;
                }
            }
        } catch(Exception $e) {}

        if (!$loadedFromDb && file_exists($CONFIG_FILE)) {
            $conf = json_decode(file_get_contents($CONFIG_FILE), true);
            if ($conf) {
                $customRoles  = $conf['customRoles']  ?? [];
                $trafficRules = $conf['trafficRules'] ?? [];
            }
        }

        $areas = [];
        try {
            $stmtA = $pdo->query("SELECT * FROM areas_estrategicas");
            if ($stmtA) $areas = $stmtA->fetchAll();
        } catch (Exception $e) {}

        limpiarYResponder([
            'status'       => 'success',
            'version'      => '12.0',
            'users'        => $users,
            'customRoles'  => $customRoles,
            'trafficRules' => $trafficRules,
            'areas'        => $areas,
            'circles'      => [],
            'events'       => []
        ]);
    } catch (Exception $e) {
        limpiarYResponder(['status' => 'error', 'message' => 'Error interno del servidor.'], 500);
    }
}

if ($action === 'load_circles_lite') {
    requireAuth();
    try {
        while (ob_get_level()) { ob_end_clean(); }

        header("Content-Type: application/json; charset=UTF-8");
        header("X-Content-Type-Options: nosniff");
        http_response_code(200);

        $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
        $stmt = $pdo->query("SELECT unique_id, data FROM circles");

        echo '{"status":"success","circles":[';
        $first = true;

        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $circle = json_decode($row['data'], true);
            if ($circle) {
                if (isset($circle['cedulas']) && is_array($circle['cedulas'])) {
                    foreach ($circle['cedulas'] as &$cedula) {
                        unset($cedula['ine_data'], $cedula['ine_frente'], $cedula['ine_reverso'], $cedula['foto_perfil'], $cedula['firma']);
                        $cedula['has_ine'] = true;
                    }
                    unset($cedula);
                }
                $circle['_db_uid'] = $row['unique_id'];
                if (!$first) echo ',';
                echo json_encode($circle);
                $first = false;
            }
            unset($circle, $row);
        }

        $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, true);

        echo '],"events":[';
        $stmtE = $pdo->query("SELECT data FROM events");
        $firstE = true;
        while ($rowE = $stmtE->fetch(PDO::FETCH_ASSOC)) {
            $ev = json_decode($rowE['data'], true);
            if ($ev) {
                if (!$firstE) echo ',';
                echo json_encode($ev);
                $firstE = false;
            }
            unset($ev, $rowE);
        }

        echo ']}';
        exit;

    } catch (Exception $e) {
        $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, true);
        exit;
    }
}

if ($action === 'get_circle_details') {
    requireAuth();
    $uid = $_GET['uid'] ?? '';
    if (!$uid) limpiarYResponder(['error' => 'Falta UID'], 400);

    try {
        $stmt = $pdo->prepare("SELECT data FROM circles WHERE unique_id = ? LIMIT 1");
        $stmt->execute([$uid]);
        $row = $stmt->fetch();

        if ($row) {
            $fullData = json_decode($row['data'], true);
            $fullData['_db_uid'] = $uid;

            if (isset($fullData['cedulas']) && is_array($fullData['cedulas'])) {
                foreach ($fullData['cedulas'] as &$ced) {
                    foreach (['ine_data', 'foto_perfil', 'firma'] as $field) {
                        if (isset($ced[$field]) && strpos($ced[$field], 'uploads/') === 0) {
                            $ced[$field] = $BASE_URL . $ced[$field];
                        }
                    }
                }
                unset($ced);
            }

            limpiarYResponder($fullData);
        } else {
            limpiarYResponder(['error' => 'No encontrado'], 404);
        }
    } catch (Exception $e) {
        limpiarYResponder(['status' => 'error', 'message' => 'Error interno del servidor.'], 500);
    }
}

// ====================================================================
// 9. RUTAS POST (ESCRITURA) — REQUIEREN AUTENTICACIÓN
// ====================================================================

if ($_SERVER['REQUEST_METHOD'] === 'POST') {

    // ------------------------------------------------------------------
    // GUARDAR CÍRCULO
    // ------------------------------------------------------------------
    if ($action === 'save_circle') {
        requireAuth();
        try {
            function saveBase64Image(string $base64, string $prefix): ?string {
                if (!preg_match('/^data:image\/(jpeg|jpg|png);base64,/', $base64, $type)) return null;

                $data = base64_decode(substr($base64, strpos($base64, ',') + 1));
                if ($data === false) return null;

                $finfo = finfo_open(FILEINFO_MIME_TYPE);
                $mime  = finfo_buffer($finfo, $data);
                finfo_close($finfo);

                if (!in_array($mime, ['image/jpeg', 'image/png'], true)) return null;

                $ext = $type[1] === 'jpeg' ? 'jpg' : $type[1];
                $dir = 'uploads/' . date('Y/m/');
                if (!is_dir($dir)) mkdir($dir, 0755, true);

                $filename = $prefix . '_' . bin2hex(random_bytes(8)) . '.' . $ext;
                $filepath = $dir . $filename;

                return file_put_contents($filepath, $data) ? $filepath : null;
            }

            array_walk_recursive($input, function (&$item, $key) {
                if (is_string($item) && strpos($item, 'data:image') === 0) {
                    $prefix = 'img';
                    if (strpos($key, 'ine')   !== false) $prefix = 'ine';
                    if (strpos($key, 'firma') !== false) $prefix = 'sig';
                    if (strpos($key, 'foto')  !== false) $prefix = 'photo';
                    $saved = saveBase64Image($item, $prefix);
                    if ($saved) $item = $saved;
                }
            });

            if (!empty($input['_db_uid'])) {
                $uid = $input['_db_uid'];
            } elseif (!empty($input['unique_id'])) {
                $uid = $input['unique_id'];
            } else {
                $uid = preg_replace('/[^a-zA-Z0-9_]/', '', ($input['timestamp'] ?? '') . '_' . ($input['acta']['nombre'] ?? 'sin_nombre'));
            }

            $coord  = $input['coordinador_usuario'] ?? $_SESSION['usuario'];
            $estado = $input['acta']['estado'] ?? 'Desconocido';

            unset($input['_db_uid'], $input['_isFullDetails']);

            $jsonData = json_encode($input);

            $stmtCheck = $pdo->prepare("SELECT unique_id FROM circles WHERE unique_id = ? LIMIT 1");
            $stmtCheck->execute([$uid]);

            if ($stmtCheck->fetch()) {
                $pdo->prepare("UPDATE circles SET data = ?, coordinador_usuario = ?, estado_circulo = ? WHERE unique_id = ?")
                    ->execute([$jsonData, $coord, $estado, $uid]);
            } else {
                $pdo->prepare("INSERT INTO circles (unique_id, data, coordinador_usuario, estado_circulo) VALUES (?, ?, ?, ?)")
                    ->execute([$uid, $jsonData, $coord, $estado]);
            }

            limpiarYResponder(['status' => 'success', 'uid' => $uid]);

        } catch (Exception $e) {
            limpiarYResponder(['status' => 'error', 'message' => 'Error al guardar el círculo.'], 500);
        }
    }

    // ------------------------------------------------------------------
    // GUARDAR CONFIGURACIÓN (solo alto mando)
    // ------------------------------------------------------------------
    if ($action === 'save_config') {
        requireRole(['coordinador_nacional', 'admin', 'superadmin', 'secretario_nacional']);
        try {
            $jsonConfig = json_encode($input);
            $dbSuccess  = false;

            try {
                $pdo->prepare("INSERT INTO system_config (config_key, config_value) VALUES ('global', ?) ON DUPLICATE KEY UPDATE config_value = ?")
                    ->execute([$jsonConfig, $jsonConfig]);
                $dbSuccess = true;
            } catch (Exception $e) {}

            $fileSuccess = @file_put_contents($CONFIG_FILE, $jsonConfig);

            if ($dbSuccess || $fileSuccess !== false) {
                limpiarYResponder(['status' => 'success']);
            } else {
                limpiarYResponder(['status' => 'error', 'message' => 'Fallo de escritura en servidor.'], 500);
            }
        } catch (Exception $e) {
            limpiarYResponder(['status' => 'error', 'message' => 'Error interno del servidor.'], 500);
        }
    }

    // ------------------------------------------------------------------
    // GUARDAR USUARIO
    // Dos caminos:
    //   A) Auto-update: el usuario edita su propio perfil (nombre, foto, whatsapp, password)
    //   B) Admin-update / creación: requiere rol de alto mando
    // ------------------------------------------------------------------
    if ($action === 'save_user') {
        requireAuth();
        try {
            $u    = $input;
            $foto = $u['foto'] ?? null;

            // Detectar si es el propio usuario el que edita
            $targetUsuario = $u['id'] ?? $u['usuario'] ?? '';
            $isSelfUpdate  = ($targetUsuario !== '' && $targetUsuario === $_SESSION['usuario']);

            if (!$isSelfUpdate) {
                // ── Autorización por nivel de rol ──────────────────────────────────
                $rolSesion    = $_SESSION['rol']    ?? '';
                $estadoSesion = $_SESSION['estado'] ?? '';

                // Tier 1: alto mando nacional (Nivel 1) — sin restricciones de ámbito
                // coordinador_nacional es Nivel 2 (lectura) y NO puede crear ni editar usuarios
                $ROLES_NACIONALES = ['admin', 'superadmin', 'secretario_nacional'];

                // Tier 2: roles estatales — pueden crear/editar dentro de su estado
                //         con restricción de roles asignables
                $ROLES_ESTATALES  = [
                    'secretario_estatal',
                    'delegado_estatal_jovenes',      'delegado_estatal_mujeres',
                    'delegado_estatal_trabajadores', 'delegado_estatal_fundacion',
                    'delegado_estatal_productores',  'coordinador_estatal_usa',
                    'secretario_municipal',
                ];

                // Qué roles puede asignar cada rol estatal
                $ROLES_ASIGNABLES = [
                    'secretario_estatal'             => [
                        'secretario_municipal', 'coordinador_distrital_federal',
                        'coordinador_distrital_local', 'regidor', 'sindico',
                        'diputado_local', 'delegado_especial', 'invitado_especial',
                        'delegado_municipal_jovenes',      'delegado_municipal_mujeres',
                        'delegado_municipal_trabajadores', 'delegado_municipal_fundacion',
                        'delegado_municipal_productores',
                    ],
                    'delegado_estatal_jovenes'       => ['delegado_municipal_jovenes',       'delegado_circunscripcion_jovenes'      ],
                    'delegado_estatal_mujeres'       => ['delegado_municipal_mujeres',        'delegado_circunscripcion_mujeres'     ],
                    'delegado_estatal_trabajadores'  => ['delegado_municipal_trabajadores',   'delegado_circunscripcion_trabajadores'],
                    'delegado_estatal_fundacion'     => ['delegado_municipal_fundacion',      'delegado_circunscripcion_fundacion'   ],
                    'delegado_estatal_productores'   => ['delegado_municipal_productores',    'delegado_circunscripcion_productores' ],
                    // Secretario Municipal: nivel bajo, solo puede registrar invitados
                    'secretario_municipal'           => ['invitado_especial'],
                    'coordinador_estatal_usa'        => ['coordinador_estatal_usa'],
                ];

                if (in_array($rolSesion, $ROLES_NACIONALES)) {
                    // ✅ Sin restricciones adicionales

                } elseif (in_array($rolSesion, $ROLES_ESTATALES)) {
                    $targetEstado = $u['estado'] ?? '';
                    $targetRol    = $u['rol']    ?? '';
                    $isNew        = empty($u['id']);

                    // Crear: el nuevo usuario debe pertenecer al mismo estado
                    if ($isNew && $targetEstado !== $estadoSesion) {
                        limpiarYResponder(['status' => 'error',
                            'message' => 'Solo puedes crear usuarios en tu propio estado (' . $estadoSesion . ').'], 403);
                    }

                    // Editar: solo puede modificar usuarios de su propio estado
                    if (!$isNew) {
                        $chk = $pdo->prepare("SELECT estado FROM users WHERE usuario = ?");
                        $chk->execute([$u['id']]);
                        $existingRow = $chk->fetch();
                        if ($existingRow && $existingRow['estado'] !== $estadoSesion) {
                            limpiarYResponder(['status' => 'error',
                                'message' => 'No puedes editar usuarios de otro estado.'], 403);
                        }
                    }

                    // Verificar que el rol asignado esté dentro de los permitidos
                    $permitidos = $ROLES_ASIGNABLES[$rolSesion] ?? [];
                    if (!empty($targetRol) && !in_array($targetRol, $permitidos)) {
                        limpiarYResponder(['status' => 'error',
                            'message' => 'No tienes permiso para asignar el rol "' . $targetRol . '".'], 403);
                    }

                } else {
                    // ❌ Rol sin permisos de gestión de usuarios
                    limpiarYResponder(['status' => 'error',
                        'message' => 'Acceso denegado: tu rol no permite gestionar usuarios.'], 403);
                }
            }

            if ($isSelfUpdate) {
                // ── CAMINO A: Auto-update ──
                // Solo se permiten campos seguros. El rol, estado, distrito etc. los
                // impone el servidor con los valores que ya tiene en BD.
                if (!empty($u['password'])) {
                    $hash = password_hash($u['password'], PASSWORD_BCRYPT, ['cost' => 12]);
                    $pdo->prepare("UPDATE users SET nombre=?, whatsapp=?, foto=?, password=? WHERE usuario=?")
                        ->execute([$u['nombre'] ?? '', $u['whatsapp'] ?? '', $foto, $hash, $_SESSION['usuario']]);
                } else {
                    $pdo->prepare("UPDATE users SET nombre=?, whatsapp=?, foto=? WHERE usuario=?")
                        ->execute([$u['nombre'] ?? '', $u['whatsapp'] ?? '', $foto, $_SESSION['usuario']]);
                }

            } elseif (!empty($u['id'])) {
                // ── CAMINO B1: Editar otro usuario (admin) ──
                $multiestatal = (isset($u['multiestatal']) && $u['multiestatal']) ? 1 : 0;
                if (!empty($u['password'])) {
                    $hash = password_hash($u['password'], PASSWORD_BCRYPT, ['cost' => 12]);
                    $pdo->prepare("UPDATE users SET usuario=?, password=?, rol=?, nombre=?, estado=?, multiestatal=?, municipio=?, distrito=?, circunscripcion=?, whatsapp=?, foto=? WHERE usuario=?")
                        ->execute([
                            $u['usuario'], $hash, $u['rol'], $u['nombre'], $u['estado'], $multiestatal,
                            $u['municipio'] ?? '', $u['distrito'] ?? '', $u['circunscripcion'] ?? '',
                            $u['whatsapp'] ?? '', $foto, $u['id']
                        ]);
                } else {
                    $pdo->prepare("UPDATE users SET usuario=?, rol=?, nombre=?, estado=?, multiestatal=?, municipio=?, distrito=?, circunscripcion=?, whatsapp=?, foto=? WHERE usuario=?")
                        ->execute([
                            $u['usuario'], $u['rol'], $u['nombre'], $u['estado'], $multiestatal,
                            $u['municipio'] ?? '', $u['distrito'] ?? '', $u['circunscripcion'] ?? '',
                            $u['whatsapp'] ?? '', $foto, $u['id']
                        ]);
                }
            } else {
                // ── CAMINO B2: Crear nuevo usuario (admin) ──
                if (empty($u['password'])) {
                    limpiarYResponder(['status' => 'error', 'message' => 'La contraseña es obligatoria para nuevos usuarios.'], 400);
                }
                $multiestatal = (isset($u['multiestatal']) && $u['multiestatal']) ? 1 : 0;
                $hash = password_hash($u['password'], PASSWORD_BCRYPT, ['cost' => 12]);
                $pdo->prepare("INSERT INTO users (usuario, password, rol, nombre, estado, multiestatal, municipio, distrito, circunscripcion, whatsapp, foto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    ->execute([
                        $u['usuario'], $hash, $u['rol'], $u['nombre'], $u['estado'], $multiestatal,
                        $u['municipio'] ?? '', $u['distrito'] ?? '', $u['circunscripcion'] ?? '',
                        $u['whatsapp'] ?? '', $foto
                    ]);
            }

            // ── Fix v15.25: Si el username cambió, actualizar coordinador_usuario en circles ──
            if (!$isSelfUpdate && !empty($u['id']) && !empty($u['usuario']) && $u['id'] !== $u['usuario']) {
                try {
                    $pdo->prepare("UPDATE circles SET coordinador_usuario = ? WHERE coordinador_usuario = ?")
                        ->execute([$u['usuario'], $u['id']]);
                    logAction($pdo, $_SESSION['usuario'], 'reasignar_circulos_usuario', $u['id'],
                        "Username cambiado de {$u['id']} a {$u['usuario']} — círculos reasignados");
                } catch(Exception $e) { /* silencioso, no bloquea el save */ }
            }

            limpiarYResponder(['status' => 'success']);
        } catch (Exception $e) {
            limpiarYResponder(['status' => 'error', 'message' => 'Error al guardar el usuario.'], 500);
        }
    }

    // ------------------------------------------------------------------
    // GUARDAR EVENTO
    // ------------------------------------------------------------------
    if ($action === 'save_event') {
        requireAuth();
        try {
            $uid  = $input['id']   ?? '';
            $date = $input['date'] ?? '';
            if (!$uid) limpiarYResponder(['status' => 'error', 'message' => 'ID de evento requerido.'], 400);

            $json = json_encode($input);

            $stmtCheck = $pdo->prepare("SELECT unique_id FROM events WHERE unique_id = ? LIMIT 1");
            $stmtCheck->execute([$uid]);

            if ($stmtCheck->fetch()) {
                $pdo->prepare("UPDATE events SET data=?, date_event=? WHERE unique_id=?")->execute([$json, $date, $uid]);
            } else {
                $pdo->prepare("INSERT INTO events (unique_id, data, date_event) VALUES (?, ?, ?)")->execute([$uid, $json, $date]);
            }

            limpiarYResponder(['status' => 'success']);
        } catch (Exception $e) {
            limpiarYResponder(['status' => 'error', 'message' => 'Error al guardar el evento.'], 500);
        }
    }

    // ------------------------------------------------------------------
    // ELIMINAR ELEMENTO
    // ------------------------------------------------------------------
    if ($action === 'delete_item') {
        requireAuth();
        try {
            $type = $input['type'] ?? '';
            $id   = $input['id']   ?? '';

            if (!$type || !$id) limpiarYResponder(['status' => 'error', 'message' => 'Tipo e ID requeridos.'], 400);

            if ($type === 'user') {
                // Solo el Alto Mando (Nivel 1) puede eliminar usuarios
                requireRole(['admin', 'superadmin', 'secretario_nacional']);
                // No permitir que el usuario se elimine a sí mismo
                if ($id === $_SESSION['usuario']) {
                    limpiarYResponder(['status' => 'error', 'message' => 'No puedes eliminar tu propia cuenta.'], 403);
                }
                $pdo->prepare("DELETE FROM users WHERE usuario = ?")->execute([$id]);
                logAction($pdo, $_SESSION['usuario'], 'eliminar_usuario', $id, '');

            } elseif ($type === 'circle') {
                // Solo el Alto Mando (Nivel 1) puede eliminar círculos
                requireRole(['admin', 'superadmin', 'secretario_nacional']);
                $pdo->prepare("DELETE FROM circles WHERE unique_id = ?")->execute([$id]);
                logAction($pdo, $_SESSION['usuario'], 'eliminar_circulo', $id, '');

            } elseif ($type === 'event') {
                $pdo->prepare("DELETE FROM events WHERE unique_id = ?")->execute([$id]);

            } else {
                limpiarYResponder(['status' => 'error', 'message' => 'Tipo de elemento inválido.'], 400);
            }

            limpiarYResponder(['status' => 'deleted']);
        } catch (Exception $e) {
            limpiarYResponder(['status' => 'error', 'message' => 'Error al eliminar.'], 500);
        }
    }

    // ------------------------------------------------------------------
    // PING / HEARTBEAT — usa la sesión del servidor, no el body
    // ------------------------------------------------------------------
    if ($action === 'ping_user') {
        requireAuth();
        try {
            $pdo->prepare("UPDATE users SET ultima_conexion = NOW() WHERE usuario = ?")
                ->execute([$_SESSION['usuario']]);

            // Leer force_logout — si está activo, cerrar sesión del usuario actual
            $forceLogoutStatus = ['activo' => false];
            try {
                $flStmt = $pdo->prepare("SELECT config_value FROM system_config WHERE config_key = 'force_logout' LIMIT 1");
                $flStmt->execute();
                $flRow = $flStmt->fetch(PDO::FETCH_ASSOC);
                if ($flRow && !empty($flRow['config_value'])) {
                    $fl = json_decode($flRow['config_value'], true);
                    if (is_array($fl)) $forceLogoutStatus = $fl;
                }
            } catch(Exception $e) {}

            // Si force_logout activo y usuario no es admin de consola, cerrar sesión
            if (!empty($forceLogoutStatus['activo'])) {
                $rolActual = $_SESSION['rol'] ?? '';
                $esAdminGlobal = in_array($rolActual, ['admin', 'superadmin', 'secretario_nacional']);
                if (!$esAdminGlobal) {
                    $_SESSION = [];
                    session_destroy();
                    limpiarYResponder(['status' => 'force_logout', 'message' => 'Sesión cerrada por el administrador.'], 401);
                }
            }

            // Leer anuncio global
            $announcementStatus = ['activo' => false];
            try {
                $anStmt = $pdo->prepare("SELECT config_value FROM system_config WHERE config_key = 'announcement' LIMIT 1");
                $anStmt->execute();
                $anRow = $anStmt->fetch(PDO::FETCH_ASSOC);
                if ($anRow && !empty($anRow['config_value'])) {
                    $an = json_decode($anRow['config_value'], true);
                    if (is_array($an)) $announcementStatus = $an;
                }
            } catch(Exception $e) {}

            limpiarYResponder([
                'status'       => 'success',
                'maintenance'  => $_maintenanceStatus,
                'announcement' => $announcementStatus,
            ]);
        } catch (Exception $e) {
            limpiarYResponder(['status' => 'error', 'message' => 'Error al actualizar conexión.'], 500);
        }
    }
}

// ====================================================================
// VALIDAR CREDENCIAL / ASISTENCIA — acceso público (sin requireAuth)
// ====================================================================
if ($action === 'validate_credential') {
    $credId  = trim($_GET['cred_id']  ?? $input['cred_id']  ?? '');
    $curp    = trim($_GET['curp']     ?? $input['curp']     ?? '');

    if ($credId === '' && $curp === '') {
        limpiarYResponder(['status' => 'error', 'message' => 'Se requiere cred_id o curp.'], 400);
    }

    try {
        // Busca en todos los círculos el integrante que coincida
        $stmt = $pdo->query("SELECT data FROM circles ORDER BY created_at DESC");
        $rows = $stmt->fetchAll();

        foreach ($rows as $row) {
            $circle = json_decode($row['data'], true);
            if (!isset($circle['cedulas']) || !is_array($circle['cedulas'])) continue;

            foreach ($circle['cedulas'] as $m) {
                $matchCurp = ($curp !== '' && !empty($m['curp']) && strtoupper($m['curp']) === strtoupper($curp));
                // cred_id matching uses nombre + circle ID heuristic (QR payload contains unique_id)
                $matchId   = ($credId !== '' && !empty($circle['unique_id']) && $credId === $circle['unique_id']);

                if ($matchCurp || $matchId) {
                    limpiarYResponder([
                        'status'   => 'found',
                        'nombre'   => $m['nombre'] ?? '',
                        'rol'      => ($m['es_coordinador'] ?? false) ? 'Coordinador de Círculo' : 'Integrante',
                        'circulo'  => $circle['acta']['nombre'] ?? '',
                        'estado'   => $circle['acta']['estado'] ?? '',
                        'municipio'=> $circle['acta']['municipio'] ?? '',
                        'seccion'  => $circle['acta']['seccion'] ?? '',
                        'curp'     => $m['curp'] ?? '',
                        'circle_id'=> $circle['unique_id'] ?? ''
                    ]);
                }
            }
        }

        limpiarYResponder(['status' => 'not_found', 'message' => 'Credencial no encontrada en la base de datos.']);
    } catch (Exception $e) {
        limpiarYResponder(['status' => 'error', 'message' => 'Error al consultar.'], 500);
    }
}

// ====================================================================
// SOLICITUDES DE CAMBIO DE ROL
// ====================================================================

if ($action === 'request_role_change') {
    requireAuth();
    $usuario       = $_SESSION['usuario'];
    $rol_actual    = $_SESSION['rol'] ?? '';
    $rol_solicitado = trim($input['rol_solicitado'] ?? '');
    $motivo        = trim($input['motivo'] ?? '');

    if (!$rol_solicitado) {
        limpiarYResponder(['status' => 'error', 'message' => 'Debes indicar el rol solicitado.'], 400);
    }
    if ($rol_solicitado === $rol_actual) {
        limpiarYResponder(['status' => 'error', 'message' => 'Ya tienes ese rol asignado.'], 400);
    }

    // Verificar que no haya una solicitud pendiente activa
    $stmtChk = $pdo->prepare("SELECT id FROM role_change_requests WHERE usuario = ? AND estado = 'pendiente' LIMIT 1");
    $stmtChk->execute([$usuario]);
    if ($stmtChk->fetch()) {
        limpiarYResponder(['status' => 'error', 'message' => 'Ya tienes una solicitud de cambio de ROL pendiente. Espera a que el administrador la resuelva.']);
    }

    // Obtener nombre del usuario
    $stmtU = $pdo->prepare("SELECT nombre FROM users WHERE usuario = ? LIMIT 1");
    $stmtU->execute([$usuario]);
    $uRow = $stmtU->fetch();
    $nombre = $uRow['nombre'] ?? $usuario;

    $stmtIns = $pdo->prepare("INSERT INTO role_change_requests (usuario, nombre, rol_actual, rol_solicitado, motivo) VALUES (?,?,?,?,?)");
    $stmtIns->execute([$usuario, $nombre, $rol_actual, $rol_solicitado, $motivo]);

    limpiarYResponder(['status' => 'success', 'message' => 'Solicitud enviada. El administrador recibirá tu petición y te notificará.']);
}

if ($action === 'get_role_requests') {
    requireRole(['admin', 'superadmin', 'secretario_nacional']); // coordinador_nacional es lectura, no resuelve

    $stmt = $pdo->query("SELECT * FROM role_change_requests ORDER BY FIELD(estado,'pendiente','aprobado','rechazado'), created_at DESC LIMIT 100");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    limpiarYResponder(['status' => 'success', 'requests' => $rows]);
}

if ($action === 'resolve_role_request') {
    requireRole(['admin', 'superadmin', 'secretario_nacional']); // coordinador_nacional es lectura, no resuelve

    $id       = intval($input['id'] ?? 0);
    $decision = $input['decision'] ?? '';  // 'aprobado' | 'rechazado'
    $nota     = trim($input['nota'] ?? '');
    $resolver = $_SESSION['usuario'];

    if (!$id || !in_array($decision, ['aprobado', 'rechazado'], true)) {
        limpiarYResponder(['status' => 'error', 'message' => 'Parámetros inválidos.'], 400);
    }

    // Obtener la solicitud
    $stmtGet = $pdo->prepare("SELECT * FROM role_change_requests WHERE id = ? LIMIT 1");
    $stmtGet->execute([$id]);
    $req = $stmtGet->fetch(PDO::FETCH_ASSOC);

    if (!$req) {
        limpiarYResponder(['status' => 'error', 'message' => 'Solicitud no encontrada.'], 404);
    }
    if ($req['estado'] !== 'pendiente') {
        limpiarYResponder(['status' => 'error', 'message' => 'Esta solicitud ya fue resuelta.']);
    }

    // Actualizar estado de la solicitud
    $stmtUpd = $pdo->prepare("UPDATE role_change_requests SET estado=?, resuelto_por=?, resolucion_nota=?, resolved_at=NOW() WHERE id=?");
    $stmtUpd->execute([$decision, $resolver, $nota, $id]);

    // Si fue aprobada, actualizar el rol del usuario en la tabla users
    if ($decision === 'aprobado') {
        $stmtRol = $pdo->prepare("UPDATE users SET rol = ? WHERE usuario = ?");
        $stmtRol->execute([$req['rol_solicitado'], $req['usuario']]);
    }

    limpiarYResponder(['status' => 'success', 'message' => $decision === 'aprobado' ? 'Solicitud aprobada. Rol actualizado.' : 'Solicitud rechazada.']);
}

// ====================================================================
// SOLICITUDES DE BORRADO
// ====================================================================

// Crear una solicitud de borrado (secretario_estatal y roles estatales)
if ($action === 'request_deletion') {
    requireAuth();
    $rolSesion  = $_SESSION['rol']    ?? '';
    $estadoSes  = $_SESSION['estado'] ?? '';
    $solicitante = $_SESSION['usuario'];

    // Solo roles estatales pueden solicitar (no pueden borrar directo)
    $rolesPermitidos = ['secretario_estatal','delegado_estatal_jovenes','delegado_estatal_mujeres',
                        'delegado_estatal_trabajadores','delegado_estatal_fundacion','delegado_estatal_productores',
                        'secretario_municipal'];
    if (!in_array($rolSesion, $rolesPermitidos)) {
        limpiarYResponder(['status' => 'error', 'message' => 'Tu rol no puede solicitar borrados. Solo el Alto Mando borra directamente.'], 403);
    }

    $tipo        = $input['tipo']         ?? ''; // 'usuario' | 'circulo'
    $targetId    = trim($input['target_id']    ?? '');
    $targetNombre= trim($input['target_nombre'] ?? '');
    $motivo      = trim($input['motivo']   ?? '');

    if (!$tipo || !$targetId || !$motivo) {
        limpiarYResponder(['status' => 'error', 'message' => 'Faltan datos: tipo, target_id y motivo son requeridos.'], 400);
    }

    // Evitar duplicados pendientes para el mismo objetivo
    $stmtChk = $pdo->prepare("SELECT id FROM deletion_requests WHERE target_id = ? AND estado = 'pendiente' LIMIT 1");
    $stmtChk->execute([$targetId]);
    if ($stmtChk->fetch()) {
        limpiarYResponder(['status' => 'error', 'message' => 'Ya existe una solicitud de borrado pendiente para este elemento.']);
    }

    // Obtener nombre del solicitante
    $stmtU = $pdo->prepare("SELECT nombre FROM users WHERE usuario = ? LIMIT 1");
    $stmtU->execute([$solicitante]);
    $uRow = $stmtU->fetch();
    $nombreSol = $uRow['nombre'] ?? $solicitante;

    $stmtIns = $pdo->prepare(
        "INSERT INTO deletion_requests (solicitante, solicitante_nombre, solicitante_rol, tipo, target_id, target_nombre, motivo)
         VALUES (?,?,?,?,?,?,?)"
    );
    $stmtIns->execute([$solicitante, $nombreSol, $rolSesion, $tipo, $targetId, $targetNombre, $motivo]);
    logAction($pdo, $solicitante, 'solicitud_borrado', $targetId, "Tipo: $tipo | Motivo: $motivo");

    limpiarYResponder(['status' => 'success', 'message' => 'Solicitud enviada. El Alto Mando recibirá tu petición y te notificará.']);
}

// Consultar solicitudes de borrado (Alto Mando)
if ($action === 'get_deletion_requests') {
    requireRole(['admin', 'superadmin', 'secretario_nacional']);
    $stmt = $pdo->query(
        "SELECT * FROM deletion_requests
         ORDER BY FIELD(estado,'pendiente','aprobado','rechazado'), created_at DESC LIMIT 200"
    );
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    limpiarYResponder(['status' => 'success', 'requests' => $rows]);
}

// Aprobar o rechazar solicitud de borrado (Alto Mando)
if ($action === 'process_deletion_request') {
    requireRole(['admin', 'superadmin', 'secretario_nacional']);
    $id       = intval($input['id']       ?? 0);
    $decision = $input['decision']        ?? ''; // 'aprobado' | 'rechazado'
    $nota     = trim($input['nota']       ?? '');
    $resolver = $_SESSION['usuario'];

    if (!$id || !in_array($decision, ['aprobado', 'rechazado'])) {
        limpiarYResponder(['status' => 'error', 'message' => 'Parámetros inválidos.'], 400);
    }

    $stmtGet = $pdo->prepare("SELECT * FROM deletion_requests WHERE id = ? LIMIT 1");
    $stmtGet->execute([$id]);
    $req = $stmtGet->fetch(PDO::FETCH_ASSOC);

    if (!$req)                          limpiarYResponder(['status' => 'error', 'message' => 'Solicitud no encontrada.'], 404);
    if ($req['estado'] !== 'pendiente') limpiarYResponder(['status' => 'error', 'message' => 'Esta solicitud ya fue resuelta.']);

    // Actualizar estado
    $stmtUpd = $pdo->prepare(
        "UPDATE deletion_requests SET estado=?, resuelto_por=?, resolucion_nota=?, resolved_at=NOW() WHERE id=?"
    );
    $stmtUpd->execute([$decision, $resolver, $nota, $id]);

    // Si fue aprobada, ejecutar el borrado real
    if ($decision === 'aprobado') {
        if ($req['tipo'] === 'usuario') {
            $pdo->prepare("DELETE FROM users WHERE usuario = ?")->execute([$req['target_id']]);
            logAction($pdo, $resolver, 'eliminar_usuario', $req['target_id'], "Via solicitud #{$id} de {$req['solicitante']}");
        } elseif ($req['tipo'] === 'circulo') {
            $pdo->prepare("DELETE FROM circles WHERE unique_id = ?")->execute([$req['target_id']]);
            logAction($pdo, $resolver, 'eliminar_circulo', $req['target_id'], "Via solicitud #{$id} de {$req['solicitante']}");
        }
    }

    $msg = $decision === 'aprobado'
        ? "Solicitud aprobada. El elemento fue eliminado permanentemente."
        : "Solicitud rechazada.";
    limpiarYResponder(['status' => 'success', 'message' => $msg]);
}

// ====================================================================
// BITÁCORA DE ACCIONES
// ====================================================================
if ($action === 'get_audit_log') {
    requireRole(['admin', 'secretario_nacional']);
    $limit  = min((int)($input['limit'] ?? 300), 1000);
    $accion = trim($input['accion'] ?? '');
    $actor  = trim($input['actor']  ?? '');
    $where = []; $params = [];
    if ($accion) { $where[] = 'accion = ?'; $params[] = $accion; }
    if ($actor)  { $where[] = 'actor LIKE ?'; $params[] = "%{$actor}%"; }
    $whereStr = $where ? 'WHERE ' . implode(' AND ', $where) : '';
    $stmt = $pdo->prepare("SELECT * FROM audit_log $whereStr ORDER BY created_at DESC LIMIT ?");
    $params[] = $limit;
    $stmt->execute($params);
    limpiarYResponder(['status' => 'success', 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
}

// ====================================================================
// RECLASIFICACIÓN MASIVA DE USUARIOS
// ====================================================================
if ($action === 'reclassify_users') {
    requireRole(['admin', 'secretario_nacional']);
    $changes = $input['cambios'] ?? $input['changes'] ?? [];
    $count = 0;
    foreach ($changes as $ch) {
        $usr2  = trim($ch['usuario'] ?? '');
        $newRol = trim($ch['rol'] ?? $ch['new_rol'] ?? '');
        if (!$usr2 || !$newRol) continue;
        $pdo->prepare("UPDATE users SET rol = ? WHERE usuario = ?")->execute([$newRol, $usr2]);
        logAction($pdo, $_SESSION['usuario'], 'reclasificar_usuario', $usr2, "Nuevo rol: {$newRol}");
        $count++;
    }
    limpiarYResponder(['status' => 'success', 'updated' => $count]);
}

// ====================================================================
// MODO MANTENIMIENTO — SET/GET — v15.26
// ====================================================================

if ($action === 'set_maintenance') {
    requireRole(['admin', 'superadmin', 'secretario_nacional']);
    $activo  = !empty($input['activo']);
    $modo    = in_array($input['modo'] ?? '', ['banner', 'bloqueo']) ? $input['modo'] : 'banner';
    $mensaje = trim($input['mensaje'] ?? 'El sistema está en mantenimiento. Por favor regresa en unos minutos.');
    if (!$mensaje) $mensaje = 'El sistema está en mantenimiento.';

    $state = [
        'activo'     => $activo,
        'modo'       => $modo,
        'mensaje'    => $mensaje,
        'activado_por' => $_SESSION['usuario'],
        'desde'      => date('Y-m-d H:i:s'),
    ];

    $json = json_encode($state, JSON_UNESCAPED_UNICODE);
    $pdo->prepare("INSERT INTO system_config (config_key, config_value) VALUES ('maintenance', ?) ON DUPLICATE KEY UPDATE config_value = ?")
        ->execute([$json, $json]);

    $accionLog = $activo ? "activar_mantenimiento_{$modo}" : 'desactivar_mantenimiento';
    logAction($pdo, $_SESSION['usuario'], $accionLog, '', $mensaje);

    limpiarYResponder(['status' => 'success', 'state' => $state]);
}

if ($action === 'get_maintenance') {
    // Acción pública — no requiere autenticación (para mostrar pantalla de mantenimiento incluso en login)
    limpiarYResponder(['status' => 'success', 'maintenance' => $_maintenanceStatus]);
}

// ====================================================================
// RESCATE DE CÍRCULOS — v15.25
// ====================================================================

if ($action === 'get_circle_rescue') {
    requireRole(['admin', 'superadmin', 'secretario_nacional']);

    try {
        // Cargar todos los usuarios en un mapa username → estado
        $usersStmt = $pdo->query("SELECT usuario, nombre, rol, estado FROM users");
        $usersMap  = [];
        foreach ($usersStmt->fetchAll(PDO::FETCH_ASSOC) as $u) {
            $usersMap[$u['usuario']] = $u;
        }

        // Cargar todos los círculos — leer columnas que pueden no existir en BD antiguas
        // usando solo 'data' como fuente de verdad para máxima compatibilidad
        $circStmt = $pdo->query("SELECT unique_id, coordinador_usuario, data FROM circles");

        $limbo       = []; // Sin estado en acta
        $huerfanos   = []; // coordinador_usuario no existe en users
        $desplazados = []; // estado del círculo ≠ estado del creador

        while ($row = $circStmt->fetch(PDO::FETCH_ASSOC)) {
            $c   = json_decode($row['data'], true) ?? [];
            $uid = $row['unique_id'];

            // coordinador_usuario: columna BD tiene prioridad; fallback al JSON
            $coord    = !empty($row['coordinador_usuario'])
                        ? $row['coordinador_usuario']
                        : ($c['coordinador_usuario'] ?? '');
            $actaEdo  = strtolower(trim($c['acta']['estado'] ?? ''));
            $nombre   = $c['acta']['nombre'] ?? $uid;
            $municipio= $c['acta']['municipio'] ?? '';
            $fecha    = $c['acta']['fecha'] ?? ($c['timestamp'] ?? '');
            $nInteg   = count($c['cedulas'] ?? []);

            $item = [
                'uid'        => $uid,
                'nombre'     => $nombre,
                'municipio'  => $municipio,
                'estado_acta'=> $c['acta']['estado'] ?? '',
                'coordinador'=> $coord,
                'fecha'      => $fecha,
                'integrantes'=> $nInteg,
            ];

            if ($actaEdo === '') {
                $limbo[] = $item;
                continue;
            }

            if ($coord === '' || !isset($usersMap[$coord])) {
                $huerfanos[] = $item;
                continue;
            }

            $creadorEdo = strtolower(trim($usersMap[$coord]['estado'] ?? ''));
            if ($creadorEdo !== '' && $creadorEdo !== $actaEdo) {
                $item['estado_creador'] = $usersMap[$coord]['estado'];
                $item['nombre_creador'] = $usersMap[$coord]['nombre'];
                $desplazados[] = $item;
            }
        }

        limpiarYResponder([
            'status'      => 'success',
            'limbo'       => $limbo,
            'huerfanos'   => $huerfanos,
            'desplazados' => $desplazados,
            'resumen'     => [
                'limbo'       => count($limbo),
                'huerfanos'   => count($huerfanos),
                'desplazados' => count($desplazados),
                'total'       => count($limbo) + count($huerfanos) + count($desplazados),
            ]
        ]);

    } catch (Exception $e) {
        limpiarYResponder(['status' => 'error', 'message' => 'Error al analizar círculos: ' . $e->getMessage()]);
    }
}

// Reasignar coordinador de un círculo
if ($action === 'reassign_circle') {
    requireRole(['admin', 'superadmin', 'secretario_nacional']);
    $uid       = trim($input['uid'] ?? '');
    $newCoord  = trim($input['nuevo_coordinador'] ?? '');
    $newEstado = trim($input['nuevo_estado'] ?? '');
    if (!$uid) limpiarYResponder(['status' => 'error', 'message' => 'UID requerido.'], 400);

    // Verificar que el nuevo coordinador existe (si se proporciona)
    if ($newCoord) {
        $chk = $pdo->prepare("SELECT usuario, estado FROM users WHERE usuario = ? LIMIT 1");
        $chk->execute([$newCoord]);
        $chkRow = $chk->fetch(PDO::FETCH_ASSOC);
        if (!$chkRow) limpiarYResponder(['status' => 'error', 'message' => "Usuario '{$newCoord}' no encontrado."], 404);
    }

    // Actualizar coordinador_usuario en la tabla circles
    if ($newCoord) {
        $pdo->prepare("UPDATE circles SET coordinador_usuario = ? WHERE unique_id = ?")->execute([$newCoord, $uid]);
    }

    // Actualizar estado en el JSON si se proporciona
    if ($newEstado || $newCoord) {
        $row = $pdo->prepare("SELECT data FROM circles WHERE unique_id = ? LIMIT 1");
        $row->execute([$uid]);
        $r = $row->fetch(PDO::FETCH_ASSOC);
        if ($r) {
            $data = json_decode($r['data'], true);
            if ($newEstado) {
                $data['acta']['estado'] = $newEstado;
                $data['estado_circulo'] = $newEstado;
            }
            if ($newCoord) $data['coordinador_usuario'] = $newCoord;
            $pdo->prepare("UPDATE circles SET data = ?, estado_circulo = ? WHERE unique_id = ?")
                ->execute([json_encode($data, JSON_UNESCAPED_UNICODE), $newEstado ?: ($data['acta']['estado'] ?? ''), $uid]);
        }
    }

    logAction($pdo, $_SESSION['usuario'], 'reasignar_circulo', $uid,
        "Nuevo coordinador: {$newCoord} | Nuevo estado: {$newEstado}");
    limpiarYResponder(['status' => 'success', 'message' => 'Círculo reasignado correctamente.']);
}

// ====================================================================
// PANEL DE CONTROL DE USUARIOS — v15.24
// ====================================================================

// ── 1. Estadísticas agregadas ────────────────────────────────────────
if ($action === 'get_user_stats') {
    requireRole(['admin', 'superadmin', 'secretario_nacional']);

    $total = (int)$pdo->query("SELECT COUNT(*) FROM users")->fetchColumn();

    $stmtEdo = $pdo->query(
        "SELECT COALESCE(NULLIF(estado,''),'(Sin estado)') AS estado,
                COUNT(*) AS cnt,
                MAX(ultima_conexion) AS ultimo
         FROM users GROUP BY estado ORDER BY cnt DESC"
    );
    $porEstado = $stmtEdo->fetchAll(PDO::FETCH_ASSOC);

    $stmtRol = $pdo->query(
        "SELECT rol, COUNT(*) AS cnt, MAX(ultima_conexion) AS ultimo
         FROM users GROUP BY rol ORDER BY cnt DESC"
    );
    $porRol = $stmtRol->fetchAll(PDO::FETCH_ASSOC);

    $nunca     = (int)$pdo->query("SELECT COUNT(*) FROM users WHERE ultima_conexion IS NULL OR ultima_conexion = '0000-00-00 00:00:00'")->fetchColumn();
    $inactivos = (int)$pdo->query("SELECT COUNT(*) FROM users WHERE ultima_conexion < DATE_SUB(NOW(), INTERVAL 30 DAY) AND ultima_conexion IS NOT NULL")->fetchColumn();
    $bloqueados= (int)$pdo->query("SELECT COUNT(*) FROM users WHERE bloqueado = 1")->fetchColumn();
    $sinEstado = (int)$pdo->query("SELECT COUNT(*) FROM users WHERE (estado IS NULL OR estado = '') AND rol NOT IN ('admin','superadmin','secretario_nacional','coordinador_nacional')")->fetchColumn();

    // Nuevos en los últimos 30 días
    $nuevos30  = (int)$pdo->query("SELECT COUNT(*) FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)")->fetchColumn();

    limpiarYResponder([
        'status'     => 'success',
        'total'      => $total,
        'por_estado' => $porEstado,
        'por_rol'    => $porRol,
        'alertas'    => [
            'nunca_conectados' => $nunca,
            'inactivos_30d'    => $inactivos,
            'bloqueados'       => $bloqueados,
            'sin_estado'       => $sinEstado,
            'nuevos_30d'       => $nuevos30,
        ]
    ]);
}

// ── 2. Bloquear / desbloquear cuenta ─────────────────────────────────
if ($action === 'block_user') {
    requireRole(['admin', 'superadmin', 'secretario_nacional']);
    $target   = trim($input['usuario'] ?? '');
    $bloquear = !empty($input['bloquear']);

    if (!$target)
        limpiarYResponder(['status' => 'error', 'message' => 'Usuario requerido.'], 400);
    if ($target === $_SESSION['usuario'])
        limpiarYResponder(['status' => 'error', 'message' => 'No puedes bloquearte a ti mismo.'], 400);

    $tRow = $pdo->prepare("SELECT rol FROM users WHERE usuario = ? LIMIT 1");
    $tRow->execute([$target]);
    $tData = $tRow->fetch(PDO::FETCH_ASSOC);
    if (!$tData)
        limpiarYResponder(['status' => 'error', 'message' => 'Usuario no encontrado.'], 404);

    // Solo superadmin puede bloquear a otro admin/superadmin
    if (in_array($tData['rol'], ['admin','superadmin']) && $_SESSION['rol'] !== 'superadmin')
        limpiarYResponder(['status' => 'error', 'message' => 'Solo un superadmin puede suspender otra cuenta de alto nivel.'], 403);

    $pdo->prepare("UPDATE users SET bloqueado = ? WHERE usuario = ?")->execute([$bloquear ? 1 : 0, $target]);
    $accionLog = $bloquear ? 'bloquear_usuario' : 'desbloquear_usuario';
    logAction($pdo, $_SESSION['usuario'], $accionLog, $target, $bloquear ? 'Cuenta suspendida' : 'Cuenta reactivada');

    limpiarYResponder(['status' => 'success', 'message' => $bloquear ? 'Cuenta suspendida.' : 'Cuenta reactivada.']);
}

// ── 3. Historial de acciones de un usuario específico ────────────────
if ($action === 'get_user_history') {
    requireRole(['admin', 'superadmin', 'secretario_nacional']);
    $target = trim($input['usuario'] ?? $_GET['usuario'] ?? '');
    if (!$target)
        limpiarYResponder(['status' => 'error', 'message' => 'Usuario requerido.'], 400);

    $stmt = $pdo->prepare(
        "SELECT accion, objetivo, detalle, ip, created_at
         FROM audit_log WHERE actor = ? ORDER BY created_at DESC LIMIT 60"
    );
    $stmt->execute([$target]);
    limpiarYResponder(['status' => 'success', 'logs' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
}

// ── 4. Reset masivo de contraseñas ───────────────────────────────────
if ($action === 'bulk_reset_passwords') {
    requireRole(['admin', 'superadmin', 'secretario_nacional']);
    $usuarios = $input['usuarios'] ?? [];
    if (empty($usuarios) || !is_array($usuarios))
        limpiarYResponder(['status' => 'error', 'message' => 'Lista de usuarios requerida.'], 400);

    $palabras = ['Aguila','Bosque','Cielo','Delfin','Estrella','Fuente','Jardin','Lago',
                 'Monte','Nube','Palma','Pinar','Roca','Sierra','Sol','Valle','Viento',
                 'Cedro','Flores','Mangle','Llano','Meseta','Selva','Bahia','Canion'];
    $resultados = [];
    foreach (array_slice($usuarios, 0, 100) as $usr) { // máx 100 por llamada
        $usr = trim($usr);
        if (!$usr || $usr === $_SESSION['usuario']) continue;
        $pwd  = $palabras[array_rand($palabras)] . rand(10,99) . $palabras[array_rand($palabras)] . rand(10,99);
        $hash = password_hash($pwd, PASSWORD_BCRYPT, ['cost' => 12]);
        try {
            $pdo->prepare("UPDATE users SET password = ? WHERE usuario = ?")->execute([$hash, $usr]);
            logAction($pdo, $_SESSION['usuario'], 'reset_password', $usr, 'Reset masivo de contraseña');
            $resultados[] = ['usuario' => $usr, 'password_temporal' => $pwd];
        } catch(Exception $e) {
            $resultados[] = ['usuario' => $usr, 'error' => 'Error al actualizar'];
        }
    }
    limpiarYResponder(['status' => 'success', 'resultados' => $resultados]);
}

// Acción no reconocida
limpiarYResponder(['status' => 'error', 'message' => 'Acción no válida.'], 400);

<?php
/**
 * admin-console.php — TerritoriOp CRM
 * Consola Administrativa Out-of-Band v1.0
 *
 * SEGURIDAD:
 *   • No está vinculado desde el CRM principal — acceso solo por URL directa
 *   • Protegido por IP whitelist + token maestro configurable
 *   • Rate limiting contra fuerza bruta (usa audit_log)
 *   • Sesión propia independiente del CRM (session_name diferente)
 *   • Cada acción queda registrada en audit_log
 *
 * ACCESO:
 *   https://tudominio.com/admin-console.php
 *   → Ingresar el token maestro en el formulario de login
 *
 * CONFIGURACIÓN INICIAL:
 *   1. Cambiar AC_TOKEN por una clave larga y segura
 *   2. Agregar tus IPs a AC_IPS_PERMITIDAS (recomendado en producción)
 *   3. Subir el archivo y acceder por HTTPS
 */

// ═══════════════════════════════════════════════════════════════════
// CONFIGURACIÓN — CAMBIAR ANTES DE SUBIR A PRODUCCIÓN
// ═══════════════════════════════════════════════════════════════════

define('AC_TOKEN',           'lflIChPaiR-hIzf1qz_4QZ2uhA3uZ5SzmN4MLbBTIyo');
define('AC_IPS_PERMITIDAS',  [
    '187.170.*.*',   // Telmex Infinitum Fibra — CDMX (rango asignado a 187.170.x.x)
    // Si en algún momento cambia el segundo octeto, agrega la nueva línea aquí
    // y deja esta como respaldo hasta confirmar el nuevo rango.
]);
define('AC_MAX_INTENTOS',    5);    // Intentos fallidos antes de bloquear
define('AC_BLOQUEO_MIN',     15);   // Minutos de bloqueo tras max intentos
define('AC_TITULO',          'TerritoriOp · Consola Admin');
define('AC_VERSION',         '1.0');
define('AC_SESSION_TIMEOUT', 7200); // 2 horas

// ═══════════════════════════════════════════════════════════════════
// SETUP PHP
// ═══════════════════════════════════════════════════════════════════

error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('memory_limit', '256M');
ob_start();

// Sesión completamente separada del CRM
session_name('crm_admin_console');
ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_samesite', 'Strict');
session_start();

// ═══════════════════════════════════════════════════════════════════
// FUNCIONES DE SEGURIDAD
// ═══════════════════════════════════════════════════════════════════

function acGetIP(): string {
    $fwd = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if ($fwd) return trim(explode(',', $fwd)[0]);
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

function acIpPermitida(): bool {
    $lista = AC_IPS_PERMITIDAS;
    if (empty($lista)) return true;          // Sin restricción configurada
    $ip = acGetIP();
    foreach ($lista as $entrada) {
        $entrada = trim($entrada);
        // Wildcard: '189.216.*.*' → convierte a regex
        if (str_contains($entrada, '*')) {
            $patron = '/^' . str_replace(['.', '*'], ['\.', '\d{1,3}'], $entrada) . '$/';
            if (preg_match($patron, $ip)) return true;
            continue;
        }
        // CIDR: '189.216.0.0/16'
        if (str_contains($entrada, '/')) {
            [$red, $bits] = explode('/', $entrada, 2);
            $bits  = (int)$bits;
            $ipLng = ip2long($ip);
            $rdLng = ip2long($red);
            if ($ipLng !== false && $rdLng !== false) {
                $mascara = $bits > 0 ? (~0 << (32 - $bits)) : 0;
                if (($ipLng & $mascara) === ($rdLng & $mascara)) return true;
            }
            continue;
        }
        // IP exacta
        if ($entrada === $ip) return true;
    }
    return false;
}

function acRateCheck(?PDO $pdo): array {
    if (!$pdo) return ['bloqueado' => false, 'intentos' => 0];
    $ip = acGetIP();
    try {
        $cutoff = date('Y-m-d H:i:s', strtotime('-' . AC_BLOQUEO_MIN . ' minutes'));
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) as n FROM audit_log
             WHERE actor = ? AND accion = 'ac_login_fail' AND created_at > ?"
        );
        $stmt->execute(["IP:$ip", $cutoff]);
        $n = (int)($stmt->fetch(PDO::FETCH_ASSOC)['n'] ?? 0);
        return ['bloqueado' => $n >= AC_MAX_INTENTOS, 'intentos' => $n];
    } catch (Exception $e) {
        return ['bloqueado' => false, 'intentos' => 0];
    }
}

function acLog(?PDO $pdo, string $accion, string $detalle = ''): void {
    if (!$pdo) return;
    try {
        $pdo->prepare(
            "INSERT INTO audit_log (actor, accion, objetivo, detalle, ip) VALUES (?, ?, '', ?, ?)"
        )->execute(['CONSOLA_ADMIN', $accion, $detalle, acGetIP()]);
    } catch (Exception $e) {}
}

function acToken(): string {
    return bin2hex(random_bytes(4));
}

// CSRF simple: token en sesión
function acCsrfCheck(): bool {
    $posted = $_POST['_csrf'] ?? '';
    $stored = $_SESSION['ac_csrf'] ?? '';
    return $stored !== '' && hash_equals($stored, $posted);
}
if (empty($_SESSION['ac_csrf'])) {
    $_SESSION['ac_csrf'] = bin2hex(random_bytes(16));
}
$csrf = $_SESSION['ac_csrf'];

// ═══════════════════════════════════════════════════════════════════
// CONEXIÓN A BD (con fallback graceful)
// ═══════════════════════════════════════════════════════════════════

$pdo     = null;
$dbError = null;
if (file_exists(__DIR__ . '/db.php')) {
    try {
        require_once __DIR__ . '/db.php';
    } catch (Throwable $e) {
        $dbError = $e->getMessage();
    }
}

// ═══════════════════════════════════════════════════════════════════
// AUTENTICACIÓN
// ═══════════════════════════════════════════════════════════════════

$autenticado = !empty($_SESSION['ac_auth']);
$acError     = null;

// Logout
if (isset($_GET['logout'])) {
    acLog($pdo, 'ac_logout', 'Cierre de sesión desde consola');
    $_SESSION = [];
    session_destroy();
    header('Location: admin-console.php');
    exit;
}

// Timeout de sesión
if ($autenticado && (time() - ($_SESSION['ac_tiempo'] ?? 0)) > AC_SESSION_TIMEOUT) {
    $_SESSION = [];
    session_destroy();
    $autenticado = false;
    $acError = 'Sesión expirada. Ingresa nuevamente.';
}

// IP cambió durante sesión
if ($autenticado && ($_SESSION['ac_ip'] ?? '') !== acGetIP()) {
    $_SESSION = [];
    session_destroy();
    $autenticado = false;
    $acError = 'IP de sesión cambiada. Ingresa nuevamente.';
}

// Intentar login
if (!$autenticado && $_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['token'])) {
    $tokenInput = trim($_POST['token'] ?? '');

    if (!acIpPermitida()) {
        $acError = '⛔ Acceso denegado: IP ' . acGetIP() . ' no está en la lista permitida.';
        acLog($pdo, 'ac_login_fail', 'IP no permitida: ' . acGetIP());
    } else {
        $rate = acRateCheck($pdo);
        if ($rate['bloqueado']) {
            $acError = "🔒 Demasiados intentos fallidos. Espera " . AC_BLOQUEO_MIN . " minutos.";
        } elseif (hash_equals(AC_TOKEN, $tokenInput)) {
            $_SESSION['ac_auth']   = true;
            $_SESSION['ac_ip']     = acGetIP();
            $_SESSION['ac_tiempo'] = time();
            $autenticado = true;
            acLog($pdo, 'ac_login_ok', 'Acceso concedido');
        } else {
            $acError = '❌ Token incorrecto. (' . ($rate['intentos'] + 1) . '/' . AC_MAX_INTENTOS . ' intentos)';
            acLog($pdo, 'ac_login_fail', 'Token incorrecto');
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// ACCIONES POST (solo si autenticado + CSRF válido)
// ═══════════════════════════════════════════════════════════════════

$acMsg     = null;
$acMsgTipo = 'ok'; // ok | error | warn

if ($autenticado && $_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['ac_action'])) {
    if (!acCsrfCheck()) {
        $acMsg = '⚠️ Token CSRF inválido. Recarga la página.';
        $acMsgTipo = 'error';
    } else {
        $ac = $_POST['ac_action'];

        // ── Mantenimiento ───────────────────────────────────────────
        if ($ac === 'set_maintenance' && $pdo) {
            $activo = ($_POST['activo'] ?? '0') === '1';
            $modo   = in_array($_POST['modo'] ?? '', ['banner', 'bloqueo']) ? $_POST['modo'] : 'banner';
            $msg    = trim($_POST['mensaje'] ?? 'El sistema está en mantenimiento.');
            $state  = ['activo' => $activo, 'modo' => $modo, 'mensaje' => $msg, 'desde' => date('Y-m-d H:i:s')];
            try {
                $pdo->prepare("INSERT INTO system_config (config_key,config_value) VALUES ('maintenance',?)
                               ON DUPLICATE KEY UPDATE config_value=?")
                    ->execute([json_encode($state), json_encode($state)]);
                $acMsg = $activo ? "✅ Modo mantenimiento activado ($modo)." : "✅ Mantenimiento desactivado.";
                acLog($pdo, 'ac_set_maintenance', "activo=$activo modo=$modo");
            } catch (Exception $e) { $acMsg = "❌ " . $e->getMessage(); $acMsgTipo = 'error'; }

        // ── Anuncio global ──────────────────────────────────────────
        } elseif ($ac === 'set_announcement' && $pdo) {
            $msgA   = trim($_POST['mensaje'] ?? '');
            $tipo   = in_array($_POST['tipo'] ?? '', ['info','warning','success','danger']) ? $_POST['tipo'] : 'info';
            $activo = $msgA !== '';
            $state  = ['activo' => $activo, 'mensaje' => $msgA, 'tipo' => $tipo, 'desde' => date('Y-m-d H:i:s')];
            try {
                $pdo->prepare("INSERT INTO system_config (config_key,config_value) VALUES ('announcement',?)
                               ON DUPLICATE KEY UPDATE config_value=?")
                    ->execute([json_encode($state), json_encode($state)]);
                $acMsg = $activo ? "✅ Anuncio publicado a todos los usuarios." : "✅ Anuncio eliminado.";
                acLog($pdo, 'ac_announcement', "activo=$activo tipo=$tipo msg=$msgA");
            } catch (Exception $e) { $acMsg = "❌ " . $e->getMessage(); $acMsgTipo = 'error'; }

        // ── Desbloquear usuario ─────────────────────────────────────
        } elseif ($ac === 'unblock_user' && $pdo) {
            $usr = trim($_POST['usuario'] ?? '');
            if ($usr) {
                try {
                    $pdo->prepare("UPDATE users SET bloqueado=0 WHERE usuario=?")->execute([$usr]);
                    $acMsg = "✅ Usuario '$usr' desbloqueado.";
                    acLog($pdo, 'ac_unblock_user', "usuario=$usr");
                } catch (Exception $e) { $acMsg = "❌ " . $e->getMessage(); $acMsgTipo = 'error'; }
            }

        // ── Reset de contraseña ─────────────────────────────────────
        } elseif ($ac === 'reset_password' && $pdo) {
            $usr    = trim($_POST['usuario'] ?? '');
            $newPwd = trim($_POST['nueva_password'] ?? '');
            if ($usr && $newPwd) {
                try {
                    $hash = password_hash($newPwd, PASSWORD_BCRYPT, ['cost' => 12]);
                    $pdo->prepare("UPDATE users SET password=? WHERE usuario=?")->execute([$hash, $usr]);
                    $acMsg = "✅ Contraseña de '$usr' actualizada.";
                    acLog($pdo, 'ac_reset_password', "usuario=$usr");
                } catch (Exception $e) { $acMsg = "❌ " . $e->getMessage(); $acMsgTipo = 'error'; }
            } else {
                $acMsg = '⚠️ Completa todos los campos.'; $acMsgTipo = 'warn';
            }

        // ── Forzar cierre de todas las sesiones ─────────────────────
        } elseif ($ac === 'force_logout_all' && $pdo) {
            try {
                $state = ['activo' => true, 'desde' => date('Y-m-d H:i:s')];
                $pdo->prepare("INSERT INTO system_config (config_key,config_value) VALUES ('force_logout',?)
                               ON DUPLICATE KEY UPDATE config_value=?")
                    ->execute([json_encode($state), json_encode($state)]);
                $acMsg = "✅ Señal enviada. Todos los usuarios serán desconectados en su próximo ping (≤20s).";
                acLog($pdo, 'ac_force_logout_all', '');
            } catch (Exception $e) { $acMsg = "❌ " . $e->getMessage(); $acMsgTipo = 'error'; }

        // ── Cancelar force_logout ───────────────────────────────────
        } elseif ($ac === 'cancel_force_logout' && $pdo) {
            try {
                $state = ['activo' => false, 'desde' => date('Y-m-d H:i:s')];
                $pdo->prepare("INSERT INTO system_config (config_key,config_value) VALUES ('force_logout',?)
                               ON DUPLICATE KEY UPDATE config_value=?")
                    ->execute([json_encode($state), json_encode($state)]);
                $acMsg = "✅ Señal de force-logout cancelada.";
                acLog($pdo, 'ac_cancel_force_logout', '');
            } catch (Exception $e) { $acMsg = "❌ " . $e->getMessage(); $acMsgTipo = 'error'; }

        // ── Crear usuario de emergencia ─────────────────────────────
        } elseif ($ac === 'create_emergency_user' && $pdo) {
            $usr  = trim($_POST['usuario'] ?? '');
            $pwd  = trim($_POST['password'] ?? '');
            $nom  = trim($_POST['nombre'] ?? 'Admin Emergencia');
            if ($usr && $pwd) {
                try {
                    $existe = $pdo->prepare("SELECT 1 FROM users WHERE usuario=? LIMIT 1");
                    $existe->execute([$usr]);
                    if ($existe->fetch()) {
                        $acMsg = "⚠️ El usuario '$usr' ya existe."; $acMsgTipo = 'warn';
                    } else {
                        $hash = password_hash($pwd, PASSWORD_BCRYPT, ['cost' => 12]);
                        $pdo->prepare(
                            "INSERT INTO users (usuario,nombre,password,rol,estado,bloqueado) VALUES (?,?,?,'superadmin','Nacional',0)"
                        )->execute([$usr, $nom, $hash]);
                        $acMsg = "✅ Usuario superadmin '$usr' creado.";
                        acLog($pdo, 'ac_create_emergency_user', "usuario=$usr");
                    }
                } catch (Exception $e) { $acMsg = "❌ " . $e->getMessage(); $acMsgTipo = 'error'; }
            } else {
                $acMsg = '⚠️ Completa usuario y contraseña.'; $acMsgTipo = 'warn';
            }

        // ── Buscar en logs de auditoría ─────────────────────────────
        } elseif ($ac === 'search_audit_log' && $pdo) {
            // Solo registrar en ac_log si no es una búsqueda vacía
            $sq = trim($_POST['q_usuario'] ?? '');
            acLog($pdo, 'ac_search_audit', "busqueda por usuario='$sq'");

        // ── Limpiar logs de auditoría antiguos ──────────────────────
        } elseif ($ac === 'clean_audit_log' && $pdo) {
            $dias = max(30, (int)($_POST['dias'] ?? 90));
            try {
                $del = $pdo->prepare("DELETE FROM audit_log WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)");
                $del->execute([$dias]);
                $n = $del->rowCount();
                $acMsg = "✅ $n entradas de auditoría eliminadas (anteriores a $dias días).";
                acLog($pdo, 'ac_clean_audit_log', "dias=$dias eliminadas=$n");
            } catch (Exception $e) { $acMsg = "❌ " . $e->getMessage(); $acMsgTipo = 'error'; }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// RECOLECCIÓN DE DATOS (solo si autenticado)
// ═══════════════════════════════════════════════════════════════════

$mantenimiento  = ['activo' => false, 'modo' => 'banner', 'mensaje' => '', 'desde' => ''];
$announcement   = ['activo' => false, 'mensaje' => '', 'tipo' => 'info'];
$forceLogout    = ['activo' => false];
$conectados     = [];
$bloqueados     = [];
$dbTablas       = [];
$recentLogs     = [];
$failedLogins   = [];
$totalUsuarios  = 0;
$totalCirculos  = 0;
$totalSolicitudes = 0;
$sysHealth      = [];

if ($autenticado) {
    // Salud del sistema
    $sysHealth = [
        'php'         => PHP_VERSION,
        'memoria_uso' => round(memory_get_usage(true) / 1048576, 1) . ' MB',
        'memoria_max' => ini_get('memory_limit'),
        'disco_libre' => function_exists('disk_free_space') ? round(@disk_free_space('.') / 1073741824, 2) . ' GB' : 'N/A',
        'disco_total' => function_exists('disk_total_space') ? round(@disk_total_space('.') / 1073741824, 2) . ' GB' : 'N/A',
        'hora'        => date('Y-m-d H:i:s'),
        'zona'        => date_default_timezone_get(),
        'db'          => $pdo !== null,
        'db_error'    => $dbError,
        'extensions'  => [
            'pdo_mysql' => extension_loaded('pdo_mysql'),
            'json'      => extension_loaded('json'),
            'mbstring'  => extension_loaded('mbstring'),
            'gd'        => extension_loaded('gd'),
            'openssl'   => extension_loaded('openssl'),
            'curl'      => extension_loaded('curl'),
            'zip'       => extension_loaded('zip'),
        ],
        'os'          => PHP_OS,
        'sapi'        => php_sapi_name(),
    ];

    if ($pdo) {
        // Tablas de la BD
        foreach (['users','circles','audit_log','system_config','role_change_requests','deletion_requests'] as $t) {
            try {
                $n = $pdo->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
                $dbTablas[$t] = ['ok' => true, 'filas' => (int)$n];
            } catch (Exception $e) {
                $dbTablas[$t] = ['ok' => false, 'filas' => 0, 'error' => $e->getMessage()];
            }
        }

        // Estadísticas rápidas
        try { $totalUsuarios  = (int)$pdo->query("SELECT COUNT(*) FROM users")->fetchColumn(); } catch(Exception $e){}
        try { $totalCirculos  = (int)$pdo->query("SELECT COUNT(*) FROM circles")->fetchColumn(); } catch(Exception $e){}
        try { $totalSolicitudes = (int)$pdo->query("SELECT COUNT(*) FROM role_change_requests WHERE estado='pendiente'")->fetchColumn(); } catch(Exception $e){}

        // Usuarios conectados ahora (ping < 3 min)
        try {
            $stmt = $pdo->query(
                "SELECT usuario, nombre, rol, estado, ultima_conexion
                 FROM users WHERE ultima_conexion > DATE_SUB(NOW(), INTERVAL 3 MINUTE)
                 ORDER BY ultima_conexion DESC LIMIT 60"
            );
            $conectados = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch(Exception $e){}

        // Usuarios bloqueados
        try {
            $stmt = $pdo->query(
                "SELECT usuario, nombre, rol, estado, ultima_conexion
                 FROM users WHERE bloqueado=1 ORDER BY nombre LIMIT 100"
            );
            $bloqueados = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch(Exception $e){}

        // system_config claves relevantes
        foreach (['maintenance','announcement','force_logout'] as $key) {
            try {
                $row = $pdo->prepare("SELECT config_value FROM system_config WHERE config_key=? LIMIT 1");
                $row->execute([$key]);
                $r = $row->fetch(PDO::FETCH_ASSOC);
                if ($r && $r['config_value']) {
                    $decoded = json_decode($r['config_value'], true);
                    if (is_array($decoded)) {
                        if ($key === 'maintenance')  $mantenimiento = $decoded;
                        if ($key === 'announcement') $announcement  = $decoded;
                        if ($key === 'force_logout') $forceLogout   = $decoded;
                    }
                }
            } catch(Exception $e){}
        }

        // Logs recientes
        try {
            $recentLogs = $pdo->query(
                "SELECT actor, accion, objetivo, detalle, ip, created_at
                 FROM audit_log ORDER BY created_at DESC LIMIT 60"
            )->fetchAll(PDO::FETCH_ASSOC);
        } catch(Exception $e){}


        // Logins fallidos últimas 24h
        try {
            $failedLogins = $pdo->query(
                "SELECT actor, detalle, ip, created_at FROM audit_log
                 WHERE accion IN ('login_fail','login_failed','ac_login_fail')
                 AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
                 ORDER BY created_at DESC LIMIT 50"
            )->fetchAll(PDO::FETCH_ASSOC);
        } catch(Exception $e){}
    }
}

$tab = $_GET['tab'] ?? 'health';

ob_end_clean();

// ═══════════════════════════════════════════════════════════════════
// HELPERS DE VISTA
// ═══════════════════════════════════════════════════════════════════

function esc(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
function badge(bool $ok, string $siOk = 'OK', string $siNo = 'ERROR'): string {
    $color = $ok ? '#22c55e' : '#ef4444';
    $label = $ok ? $siOk : $siNo;
    return "<span style='background:$color;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:bold;'>$label</span>";
}
function fmtFecha(?string $f): string {
    if (!$f) return '<span style="color:#666">—</span>';
    return '<span style="color:#94a3b8;font-size:12px;">' . esc($f) . '</span>';
}

?><!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?= esc(AC_TITULO) ?> v<?= AC_VERSION ?></title>
<meta name="robots" content="noindex, nofollow">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:      #0f172a;
    --surface: #1e293b;
    --border:  #334155;
    --text:    #e2e8f0;
    --muted:   #94a3b8;
    --accent:  #f97316;
    --green:   #22c55e;
    --red:     #ef4444;
    --yellow:  #f59e0b;
    --blue:    #3b82f6;
  }
  body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; font-size: 14px; min-height: 100vh; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Layout */
  .layout { display: flex; min-height: 100vh; }
  .sidebar {
    width: 220px; background: var(--surface); border-right: 1px solid var(--border);
    display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; overflow-y: auto;
  }
  .sidebar-logo { padding: 20px 16px 12px; border-bottom: 1px solid var(--border); }
  .sidebar-logo .name { font-size: 13px; font-weight: 700; color: var(--accent); }
  .sidebar-logo .sub  { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .sidebar-nav { padding: 12px 0; flex: 1; }
  .nav-item {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 16px; color: var(--muted); cursor: pointer; text-decoration: none;
    transition: background .15s, color .15s; font-size: 13px; border-left: 3px solid transparent;
  }
  .nav-item:hover { background: rgba(255,255,255,.05); color: var(--text); text-decoration: none; }
  .nav-item.active { color: var(--accent); background: rgba(249,115,22,.08); border-left-color: var(--accent); }
  .sidebar-footer { padding: 12px 16px; border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); }

  /* Main */
  .main { flex: 1; padding: 24px; overflow-x: hidden; }
  .page-title { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .page-sub   { color: var(--muted); font-size: 13px; margin-bottom: 20px; }

  /* Cards */
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px; margin-bottom: 16px; }
  .card-title { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 14px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }

  /* Stat boxes */
  .stat { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; }
  .stat-val  { font-size: 26px; font-weight: 700; }
  .stat-lbl  { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .stat.green .stat-val { color: var(--green); }
  .stat.red   .stat-val { color: var(--red); }
  .stat.orange .stat-val { color: var(--accent); }
  .stat.blue  .stat-val { color: var(--blue); }

  /* Status indicator */
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 5px; }
  .dot.green  { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .dot.red    { background: var(--red); }
  .dot.yellow { background: var(--yellow); }

  /* Forms */
  label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; margin-top: 10px; }
  label:first-child { margin-top: 0; }
  input[type=text], input[type=password], textarea, select {
    width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); padding: 8px 10px; font-size: 13px; font-family: inherit;
  }
  input:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent); }
  textarea { resize: vertical; min-height: 70px; }
  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer;
    font-size: 13px; font-weight: 600; font-family: inherit; transition: opacity .15s;
  }
  .btn:hover { opacity: .85; }
  .btn-orange { background: var(--accent); color: #fff; }
  .btn-red    { background: var(--red); color: #fff; }
  .btn-green  { background: var(--green); color: #0f172a; }
  .btn-blue   { background: var(--blue); color: #fff; }
  .btn-ghost  { background: transparent; color: var(--muted); border: 1px solid var(--border); }
  .btn-sm     { padding: 5px 10px; font-size: 12px; }

  /* Tables */
  .tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
  .tbl th { text-align: left; padding: 8px 10px; color: var(--muted); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--border); font-weight: 600; }
  .tbl td { padding: 8px 10px; border-bottom: 1px solid rgba(51,65,85,.5); vertical-align: middle; }
  .tbl tr:last-child td { border-bottom: none; }
  .tbl tr:hover td { background: rgba(255,255,255,.025); }
  .tbl-wrap { overflow-x: auto; }

  /* Alerts */
  .alert { padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; }
  .alert-ok    { background: rgba(34,197,94,.12);  border: 1px solid rgba(34,197,94,.3);  color: #86efac; }
  .alert-error { background: rgba(239,68,68,.12);  border: 1px solid rgba(239,68,68,.3);  color: #fca5a5; }
  .alert-warn  { background: rgba(245,158,11,.12); border: 1px solid rgba(245,158,11,.3); color: #fcd34d; }

  /* Chips */
  .chip { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .chip-green  { background: rgba(34,197,94,.15);  color: var(--green); }
  .chip-red    { background: rgba(239,68,68,.15);  color: var(--red); }
  .chip-yellow { background: rgba(245,158,11,.15); color: var(--yellow); }
  .chip-blue   { background: rgba(59,130,246,.15); color: var(--blue); }
  .chip-gray   { background: rgba(148,163,184,.15);color: var(--muted); }

  /* Divider */
  .divider { border: none; border-top: 1px solid var(--border); margin: 20px 0; }

  /* Login form */
  .login-wrap { max-width: 380px; margin: 80px auto; }
  .login-wrap .card { padding: 32px; }
  .login-logo { text-align: center; margin-bottom: 24px; }
  .login-logo .icon { font-size: 42px; }
  .login-logo .title { font-size: 18px; font-weight: 700; margin-top: 8px; color: var(--accent); }
  .login-logo .sub { font-size: 12px; color: var(--muted); margin-top: 3px; }

  /* Mode toggle cards */
  .mode-card {
    border: 2px solid var(--border); border-radius: 8px; padding: 12px;
    cursor: pointer; transition: border-color .2s, background .2s; text-align: center;
  }
  .mode-card:hover { border-color: var(--accent); }
  .mode-card.selected { border-color: var(--accent); background: rgba(249,115,22,.08); }
  .mode-card .icon { font-size: 24px; }
  .mode-card .lbl { font-size: 12px; font-weight: 600; margin-top: 4px; }
  .mode-card .desc { font-size: 11px; color: var(--muted); margin-top: 3px; }

  /* Ext pills */
  .ext-pill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 20px; font-size: 12px; margin: 3px; }
  .ext-ok   { background: rgba(34,197,94,.12);  color: var(--green); border: 1px solid rgba(34,197,94,.3); }
  .ext-fail { background: rgba(239,68,68,.12);  color: var(--red);   border: 1px solid rgba(239,68,68,.3); }

  @media (max-width: 768px) {
    .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
    .sidebar { width: 180px; }
  }
</style>
</head>
<body>

<?php if (!$autenticado): ?>
<!-- ═══════════════════ LOGIN ═══════════════════ -->
<div class="login-wrap">
  <div class="card">
    <div class="login-logo">
      <div class="icon">🛡️</div>
      <div class="title"><?= esc(AC_TITULO) ?></div>
      <div class="sub">Consola Administrativa v<?= AC_VERSION ?> · Acceso restringido</div>
    </div>

    <?php if ($acError): ?>
      <div class="alert alert-error"><?= esc($acError) ?></div>
    <?php endif; ?>

    <form method="POST">
      <input type="hidden" name="_csrf" value="<?= esc($csrf) ?>">
      <label>Token de acceso</label>
      <input type="password" name="token" placeholder="Ingresa el token maestro" autofocus required>
      <br><br>
      <button type="submit" class="btn btn-orange" style="width:100%;justify-content:center;">
        🔐 Ingresar
      </button>
    </form>

    <p style="text-align:center;color:var(--muted);font-size:11px;margin-top:20px;">
      Tu IP actual: <code style="color:#f97316;user-select:all;"><?= esc(acGetIP()) ?></code><br>
      <?= date('Y-m-d H:i:s') ?>
    </p>
  </div>
</div>

<?php else: ?>
<!-- ═══════════════════ APP ═══════════════════ -->
<div class="layout">

  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-logo">
      <div class="name">🛡️ Consola Admin</div>
      <div class="sub">v<?= AC_VERSION ?> · TerritoriOp</div>
    </div>
    <nav class="sidebar-nav">
      <a class="nav-item <?= $tab==='health'        ?'active':'' ?>" href="?tab=health">📊 Estado del Sistema</a>
      <a class="nav-item <?= $tab==='maintenance'   ?'active':'' ?>" href="?tab=maintenance">🔧 Mantenimiento</a>
      <a class="nav-item <?= $tab==='users'         ?'active':'' ?>" href="?tab=users">👥 Usuarios</a>
      <a class="nav-item <?= $tab==='db'            ?'active':'' ?>" href="?tab=db">🗄️ Base de Datos</a>
      <a class="nav-item <?= $tab==='security'      ?'active':'' ?>" href="?tab=security">🔐 Seguridad</a>
      <a class="nav-item <?= $tab==='audit'         ?'active':'' ?>" href="?tab=audit">📋 Auditoría</a>
      <a class="nav-item <?= $tab==='announcement'  ?'active':'' ?>" href="?tab=announcement">📢 Anuncios</a>
      <a class="nav-item <?= $tab==='emergency'     ?'active':'' ?>" href="?tab=emergency">🚨 Emergencia</a>
    </nav>
    <div class="sidebar-footer">
      IP: <?= esc(acGetIP()) ?><br>
      <?= date('H:i:s') ?> · <a href="?logout=1">Cerrar sesión</a>
    </div>
  </aside>

  <!-- Main -->
  <main class="main">

    <?php if ($acMsg): ?>
      <div class="alert alert-<?= $acMsgTipo === 'error' ? 'error' : ($acMsgTipo === 'warn' ? 'warn' : 'ok') ?>">
        <?= esc($acMsg) ?>
      </div>
    <?php endif; ?>

    <?php if (!$pdo): ?>
      <div class="alert alert-error">
        ⚠️ <strong>Sin conexión a la base de datos.</strong>
        <?php if ($dbError): ?>— <?= esc($dbError) ?><?php endif; ?>
        Las funciones que requieren BD están deshabilitadas. Solo se muestra información del servidor.
      </div>
    <?php endif; ?>

    <!-- ══════════════ TAB: ESTADO DEL SISTEMA ══════════════ -->
    <?php if ($tab === 'health'): ?>
    <div class="page-title">📊 Estado del Sistema</div>
    <div class="page-sub">Salud del servidor, PHP y base de datos — <?= date('Y-m-d H:i:s') ?></div>

    <div class="grid-4" style="margin-bottom:16px;">
      <div class="stat <?= $sysHealth['db'] ? 'green' : 'red' ?>">
        <div class="stat-val"><?= $sysHealth['db'] ? '✓' : '✗' ?></div>
        <div class="stat-lbl">Base de Datos</div>
      </div>
      <div class="stat blue">
        <div class="stat-val"><?= $totalUsuarios ?></div>
        <div class="stat-lbl">Usuarios registrados</div>
      </div>
      <div class="stat orange">
        <div class="stat-val"><?= $totalCirculos ?></div>
        <div class="stat-lbl">Círculos ciudadanos</div>
      </div>
      <div class="stat <?= count($conectados) > 0 ? 'green' : '' ?>">
        <div class="stat-val"><?= count($conectados) ?></div>
        <div class="stat-lbl">Conectados ahora</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">🖥️ Servidor PHP</div>
        <table class="tbl">
          <tr><td style="color:var(--muted);width:140px;">Versión PHP</td><td><?= esc($sysHealth['php']) ?></td></tr>
          <tr><td style="color:var(--muted);">Sistema operativo</td><td><?= esc($sysHealth['os']) ?></td></tr>
          <tr><td style="color:var(--muted);">SAPI</td><td><?= esc($sysHealth['sapi']) ?></td></tr>
          <tr><td style="color:var(--muted);">Memoria usada</td><td><?= esc($sysHealth['memoria_uso']) ?> / <?= esc($sysHealth['memoria_max']) ?></td></tr>
          <tr><td style="color:var(--muted);">Disco libre</td><td><?= esc($sysHealth['disco_libre']) ?> / <?= esc($sysHealth['disco_total']) ?></td></tr>
          <tr><td style="color:var(--muted);">Zona horaria</td><td><?= esc($sysHealth['zona']) ?></td></tr>
          <tr><td style="color:var(--muted);">Hora del servidor</td><td><?= esc($sysHealth['hora']) ?></td></tr>
        </table>
      </div>

      <div class="card">
        <div class="card-title">🧩 Extensiones PHP</div>
        <div>
          <?php foreach ($sysHealth['extensions'] as $ext => $ok): ?>
            <span class="ext-pill <?= $ok ? 'ext-ok' : 'ext-fail' ?>">
              <?= $ok ? '✓' : '✗' ?> <?= esc($ext) ?>
            </span>
          <?php endforeach; ?>
        </div>

        <hr class="divider">
        <div class="card-title">🌐 Estado del CRM</div>
        <table class="tbl">
          <tr>
            <td style="color:var(--muted);">Modo mantenimiento</td>
            <td>
              <?php if (!empty($mantenimiento['activo'])): ?>
                <span class="chip chip-yellow">⚠️ ACTIVO — <?= esc($mantenimiento['modo'] ?? '') ?></span>
              <?php else: ?>
                <span class="chip chip-green">✅ Normal</span>
              <?php endif; ?>
            </td>
          </tr>
          <tr>
            <td style="color:var(--muted);">Anuncio global</td>
            <td>
              <?php if (!empty($announcement['activo'])): ?>
                <span class="chip chip-blue">📢 Activo</span>
              <?php else: ?>
                <span class="chip chip-gray">Sin anuncio</span>
              <?php endif; ?>
            </td>
          </tr>
          <tr>
            <td style="color:var(--muted);">Force logout</td>
            <td>
              <?php if (!empty($forceLogout['activo'])): ?>
                <span class="chip chip-red">🔴 ACTIVO</span>
              <?php else: ?>
                <span class="chip chip-gray">Inactivo</span>
              <?php endif; ?>
            </td>
          </tr>
          <tr>
            <td style="color:var(--muted);">Solicitudes pendientes</td>
            <td><?= $totalSolicitudes > 0 ? "<span class='chip chip-yellow'>⚠️ $totalSolicitudes</span>" : "<span class='chip chip-gray'>0</span>" ?></td>
          </tr>
          <tr>
            <td style="color:var(--muted);">Usuarios bloqueados</td>
            <td><?= count($bloqueados) > 0 ? "<span class='chip chip-red'>🔒 " . count($bloqueados) . "</span>" : "<span class='chip chip-gray'>0</span>" ?></td>
          </tr>
        </table>
      </div>
    </div>

    <?php if (count($conectados) > 0): ?>
    <div class="card">
      <div class="card-title"><span class="dot green"></span>Usuarios conectados ahora (últimos 3 min)</div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Último ping</th></tr></thead>
          <tbody>
            <?php foreach ($conectados as $u): ?>
            <tr>
              <td><code style="color:var(--accent)"><?= esc($u['usuario']) ?></code></td>
              <td><?= esc($u['nombre'] ?? '') ?></td>
              <td><span class="chip chip-blue"><?= esc($u['rol'] ?? '') ?></span></td>
              <td><?= esc($u['estado'] ?? '') ?></td>
              <td><?= fmtFecha($u['ultima_conexion'] ?? null) ?></td>
            </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
    </div>
    <?php endif; ?>


    <!-- ══════════════ TAB: MANTENIMIENTO ══════════════ -->
    <?php elseif ($tab === 'maintenance'): ?>
    <div class="page-title">🔧 Modo Mantenimiento</div>
    <div class="page-sub">Controla el acceso al CRM durante despliegues y cambios en el servidor</div>

    <div class="card">
      <div class="card-title">Estado actual</div>
      <?php if (!empty($mantenimiento['activo'])): ?>
        <div class="alert alert-warn">
          ⚠️ <strong>Mantenimiento ACTIVO</strong> — Modo: <strong><?= esc($mantenimiento['modo'] ?? '') ?></strong><br>
          Mensaje: <?= esc($mantenimiento['mensaje'] ?? '') ?><br>
          Desde: <?= esc($mantenimiento['desde'] ?? '') ?>
        </div>
      <?php else: ?>
        <div class="alert alert-ok">✅ Sistema en operación normal. Mantenimiento inactivo.</div>
      <?php endif; ?>
    </div>

    <form method="POST">
      <input type="hidden" name="_csrf" value="<?= esc($csrf) ?>">
      <input type="hidden" name="ac_action" value="set_maintenance">
      <div class="grid-2">
        <div class="card">
          <div class="card-title">⚙️ Activar mantenimiento</div>
          <label>Modo</label>
          <div class="grid-2" style="gap:10px;margin-bottom:12px;">
            <div class="mode-card" id="mcard-banner" onclick="selectModo('banner')">
              <div class="icon">📢</div>
              <div class="lbl">Banner informativo</div>
              <div class="desc">Usuarios siguen trabajando. Solo ven un aviso.</div>
            </div>
            <div class="mode-card" id="mcard-bloqueo" onclick="selectModo('bloqueo')">
              <div class="icon">🔒</div>
              <div class="lbl">Bloqueo total</div>
              <div class="desc">Solo admins. El resto ve pantalla de mantenimiento.</div>
            </div>
          </div>
          <input type="hidden" name="modo" id="modoInput" value="banner">

          <label>Mensaje para los usuarios</label>
          <textarea name="mensaje" rows="3" placeholder="Ej: Estamos realizando una actualización. Estaremos de vuelta en 10 minutos."><?= esc($mantenimiento['mensaje'] ?? 'El sistema está en mantenimiento. Por favor regresa en unos minutos.') ?></textarea>

          <br>
          <button type="submit" name="activo" value="1" class="btn btn-yellow" style="background:var(--yellow);color:#0f172a;margin-top:10px;">
            ⚠️ Activar mantenimiento
          </button>
        </div>

        <div class="card">
          <div class="card-title">🛑 Desactivar mantenimiento</div>
          <p style="color:var(--muted);font-size:13px;margin-bottom:14px;">
            Desactiva el modo de mantenimiento y restaura el acceso normal a todos los usuarios.
            La señal llega a todos los clientes conectados en el próximo ping (≤20s).
          </p>
          <button type="submit" name="activo" value="0" class="btn btn-green" onclick="document.getElementById('modoInput').value='banner';">
            ✅ Desactivar y restaurar acceso
          </button>
        </div>
      </div>
    </form>

    <div class="card">
      <div class="card-title">🔴 Forzar cierre de sesión global</div>
      <p style="color:var(--muted);font-size:13px;margin-bottom:14px;">
        Envía una señal a todos los usuarios conectados para cerrar su sesión en el próximo ping (≤20s).
        Útil ante brechas de seguridad o cambios críticos de credenciales.
        <strong style="color:var(--red);">Esta acción desconecta a todos los usuarios, incluyendo otros admins.</strong>
      </p>
      <?php if (!empty($forceLogout['activo'])): ?>
        <div class="alert alert-warn" style="margin-bottom:12px;">🔴 Force-logout ACTIVO desde <?= esc($forceLogout['desde'] ?? '') ?>. Los usuarios nuevos que inicien sesión también serán desconectados hasta cancelar.</div>
      <?php endif; ?>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <form method="POST" onsubmit="return confirm('¿Confirmas desconectar a TODOS los usuarios?')">
          <input type="hidden" name="_csrf" value="<?= esc($csrf) ?>">
          <input type="hidden" name="ac_action" value="force_logout_all">
          <button type="submit" class="btn btn-red">🔴 Forzar cierre de sesión global</button>
        </form>
        <?php if (!empty($forceLogout['activo'])): ?>
        <form method="POST">
          <input type="hidden" name="_csrf" value="<?= esc($csrf) ?>">
          <input type="hidden" name="ac_action" value="cancel_force_logout">
          <button type="submit" class="btn btn-green">✅ Cancelar force-logout</button>
        </form>
        <?php endif; ?>
      </div>
    </div>


    <!-- ══════════════ TAB: USUARIOS ══════════════ -->
    <?php elseif ($tab === 'users'): ?>
    <div class="page-title">👥 Gestión de Usuarios</div>
    <div class="page-sub">Desbloqueo, reset de contraseña y creación de emergencia</div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">🔓 Desbloquear usuario</div>
        <form method="POST">
          <input type="hidden" name="_csrf" value="<?= esc($csrf) ?>">
          <input type="hidden" name="ac_action" value="unblock_user">
          <label>Nombre de usuario</label>
          <input type="text" name="usuario" placeholder="usuario_exacto" required>
          <br><br>
          <button type="submit" class="btn btn-green">🔓 Desbloquear</button>
        </form>
      </div>

      <div class="card">
        <div class="card-title">🔑 Reset de contraseña</div>
        <form method="POST">
          <input type="hidden" name="_csrf" value="<?= esc($csrf) ?>">
          <input type="hidden" name="ac_action" value="reset_password">
          <label>Nombre de usuario</label>
          <input type="text" name="usuario" placeholder="usuario_exacto" required>
          <label>Nueva contraseña</label>
          <input type="password" name="nueva_password" placeholder="Mínimo 8 caracteres" required minlength="8">
          <br><br>
          <button type="submit" class="btn btn-orange">🔑 Actualizar contraseña</button>
        </form>
      </div>
    </div>

    <?php if (count($bloqueados) > 0): ?>
    <div class="card">
      <div class="card-title">🔒 Usuarios actualmente bloqueados (<?= count($bloqueados) ?>)</div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Acción</th></tr></thead>
          <tbody>
            <?php foreach ($bloqueados as $u): ?>
            <tr>
              <td><code style="color:var(--red)"><?= esc($u['usuario']) ?></code></td>
              <td><?= esc($u['nombre'] ?? '') ?></td>
              <td><span class="chip chip-gray"><?= esc($u['rol'] ?? '') ?></span></td>
              <td><?= esc($u['estado'] ?? '') ?></td>
              <td><?= fmtFecha($u['ultima_conexion'] ?? null) ?></td>
              <td>
                <form method="POST" style="display:inline">
                  <input type="hidden" name="_csrf" value="<?= esc($csrf) ?>">
                  <input type="hidden" name="ac_action" value="unblock_user">
                  <input type="hidden" name="usuario" value="<?= esc($u['usuario']) ?>">
                  <button type="submit" class="btn btn-green btn-sm">🔓 Desbloquear</button>
                </form>
              </td>
            </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
    </div>
    <?php else: ?>
    <div class="card">
      <p style="color:var(--muted);text-align:center;padding:16px;">✅ No hay usuarios bloqueados actualmente.</p>
    </div>
    <?php endif; ?>


    <!-- ══════════════ TAB: BASE DE DATOS ══════════════ -->
    <?php elseif ($tab === 'db'): ?>
    <div class="page-title">🗄️ Base de Datos</div>
    <div class="page-sub">Estado de tablas y diagnóstico de integridad</div>

    <?php if (!$pdo): ?>
      <div class="alert alert-error">❌ Sin conexión a la base de datos.</div>
    <?php else: ?>

    <div class="card">
      <div class="card-title">📋 Tablas del CRM</div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Tabla</th><th>Estado</th><th>Registros</th><th>Notas</th></tr></thead>
          <tbody>
            <?php
            $notas = [
                'users'                 => 'Usuarios del sistema',
                'circles'               => 'Círculos ciudadanos (JSON)',
                'audit_log'             => 'Bitácora de acciones',
                'system_config'         => 'Configuración global (mantenimiento, anuncios)',
                'role_change_requests'  => 'Solicitudes de cambio de rol',
                'deletion_requests'     => 'Solicitudes de borrado',
            ];
            foreach ($dbTablas as $tabla => $info): ?>
            <tr>
              <td><code style="color:var(--accent)"><?= esc($tabla) ?></code></td>
              <td><?= badge($info['ok']) ?></td>
              <td><?= $info['ok'] ? number_format($info['filas']) : '—' ?></td>
              <td style="color:var(--muted);font-size:12px;">
                <?= esc($notas[$tabla] ?? '') ?>
                <?php if (!$info['ok'] && isset($info['error'])): ?>
                  <span style="color:var(--red)"><?= esc($info['error']) ?></span>
                <?php endif; ?>
              </td>
            </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title">🔍 Diagnóstico rápido</div>
      <?php
        // Verificar columnas críticas
        $checks = [];
        $colsToCheck = [
            ['users',   'bloqueado'],
            ['users',   'ultima_ip'],
            ['users',   'ultima_conexion'],
            ['circles', 'coordinador_usuario'],
            ['circles', 'estado_circulo'],
            ['circles', 'created_at'],
        ];
        foreach ($colsToCheck as [$tabla, $col]) {
            try {
                $pdo->query("SELECT `$col` FROM `$tabla` LIMIT 0");
                $checks[] = ['ok' => true,  'label' => "$tabla.$col"];
            } catch (Exception $e) {
                $checks[] = ['ok' => false, 'label' => "$tabla.$col", 'error' => 'Columna no existe'];
            }
        }
      ?>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        <?php foreach ($checks as $c): ?>
          <span class="ext-pill <?= $c['ok'] ? 'ext-ok' : 'ext-fail' ?>">
            <?= $c['ok'] ? '✓' : '✗' ?> <?= esc($c['label']) ?>
          </span>
        <?php endforeach; ?>
      </div>
    </div>

    <?php endif; ?>


    <!-- ══════════════ TAB: SEGURIDAD ══════════════ -->
    <?php elseif ($tab === 'security'): ?>
    <div class="page-title">🔐 Seguridad</div>
    <div class="page-sub">Intentos de acceso fallidos y actividad sospechosa (últimas 24h)</div>

    <?php if (count($failedLogins) > 0): ?>
    <div class="card">
      <div class="card-title">
        ⚠️ Intentos de login fallidos — <?= count($failedLogins) ?> en las últimas 24h
      </div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Usuario / IP</th><th>Detalle</th><th>IP</th><th>Fecha</th></tr></thead>
          <tbody>
            <?php foreach ($failedLogins as $f): ?>
            <tr>
              <td><code style="color:var(--red)"><?= esc($f['actor'] ?? '') ?></code></td>
              <td style="font-size:12px;color:var(--muted)"><?= esc($f['detalle'] ?? '') ?></td>
              <td><?= esc($f['ip'] ?? '') ?></td>
              <td><?= fmtFecha($f['created_at'] ?? null) ?></td>
            </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
    </div>
    <?php else: ?>
    <div class="card">
      <p style="color:var(--muted);text-align:center;padding:16px;">✅ Sin intentos de login fallidos en las últimas 24 horas.</p>
    </div>
    <?php endif; ?>

    <div class="card">
      <div class="card-title">🛡️ Estado de seguridad del entorno</div>
      <?php
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
        $phpVersion = version_compare(PHP_VERSION, '8.0', '>=');
        $gdOk = extension_loaded('gd');
        $opensslOk = extension_loaded('openssl');
        $secItems = [
            ['HTTPS activo',               $https],
            ['PHP 8.0+',                   $phpVersion],
            ['OpenSSL disponible',         $opensslOk],
            ['GD (imágenes)',              $gdOk],
            ['display_errors desactivado', !ini_get('display_errors')],
            ['session.cookie_httponly',    (bool)ini_get('session.cookie_httponly')],
        ];
      ?>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        <?php foreach ($secItems as [$lbl, $ok]): ?>
          <span class="ext-pill <?= $ok ? 'ext-ok' : 'ext-fail' ?>">
            <?= $ok ? '✓' : '✗' ?> <?= esc($lbl) ?>
          </span>
        <?php endforeach; ?>
      </div>
    </div>


    <!-- ══════════════ TAB: AUDITORÍA ══════════════ -->
    <?php elseif ($tab === 'audit'): ?>
    <div class="page-title">📋 Auditoría del Sistema</div>
    <div class="page-sub">Busca acciones por fecha, usuario, IP o tipo de acción</div>

    <?php
    // ── Zona horaria del servidor ──────────────────────────────────
    $tzServidor    = date_default_timezone_get();
    $horaServidor  = date('Y-m-d H:i:s');
    $offsetSeg     = (new DateTime())->getOffset();          // segundos respecto a UTC
    $offsetHoras   = $offsetSeg / 3600;
    $cdmxOffset    = -6; // UTC-6 horario de verano CDMX (CDT)
    $diferenciaH   = $offsetHoras - $cdmxOffset;            // diff servidor vs CDMX
    $ajusteMsg     = '';
    if ($diferenciaH != 0) {
        $signo = $diferenciaH > 0 ? '+' : '';
        $ajusteMsg = "⚠️ El servidor corre en <strong>$tzServidor (UTC{$signo}{$offsetHoras}h)</strong>. "
                   . "Para buscar eventos de CDMX (UTC-6) debes <strong>"
                   . ($diferenciaH > 0
                       ? "sumar {$diferenciaH}h a tu hora local"
                       : "restar " . abs($diferenciaH) . "h a tu hora local")
                   . "</strong> al ingresar el rango.";
    }

    // ── Parámetros de búsqueda ─────────────────────────────────────
    $bUsuario  = trim($_GET['q_usuario']  ?? '');
    $bAccion   = trim($_GET['q_accion']   ?? '');
    $bIP       = trim($_GET['q_ip']       ?? '');
    $bDesde    = trim($_GET['q_desde']    ?? '');
    $bHasta    = trim($_GET['q_hasta']    ?? '');
    $bFecha    = trim($_GET['q_fecha']    ?? date('Y-m-d'));  // hoy por defecto
    $bHoraD    = trim($_GET['q_hora_d']   ?? '00:00');
    $bHoraH    = trim($_GET['q_hora_h']   ?? '23:59');
    $busquedaActiva = isset($_GET['buscar']);

    // Si viene búsqueda rápida por fecha+hora, construir el rango
    if ($busquedaActiva && $bFecha) {
        $bDesde = $bFecha . ' ' . $bHoraD . ':00';
        $bHasta = $bFecha . ' ' . $bHoraH . ':59';
    }

    $logsResultado = [];
    $totalResultado = 0;
    if ($busquedaActiva && $pdo) {
        try {
            $where  = [];
            $params = [];
            if ($bDesde) { $where[] = 'created_at >= ?'; $params[] = $bDesde; }
            if ($bHasta) { $where[] = 'created_at <= ?'; $params[] = $bHasta; }
            if ($bUsuario) { $where[] = 'actor LIKE ?'; $params[] = "%$bUsuario%"; }
            if ($bAccion)  { $where[] = 'accion LIKE ?'; $params[] = "%$bAccion%"; }
            if ($bIP)      { $where[] = 'ip LIKE ?';    $params[] = "%$bIP%"; }

            $sql = "SELECT actor, accion, objetivo, detalle, ip, created_at FROM audit_log"
                 . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
                 . " ORDER BY created_at DESC LIMIT 200";
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            $logsResultado = $stmt->fetchAll(PDO::FETCH_ASSOC);
            $totalResultado = count($logsResultado);
        } catch(Exception $e) {
            $acMsg = '❌ Error en búsqueda: ' . $e->getMessage();
            $acMsgTipo = 'error';
        }
    }
    ?>

    <?php if ($acMsg): ?>
      <div class="alert alert-<?= $acMsgTipo === 'error' ? 'error' : 'ok' ?>"><?= esc($acMsg) ?></div>
    <?php endif; ?>

    <!-- Zona horaria del servidor -->
    <div class="card" style="margin-bottom:14px;padding:12px 16px;">
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:13px;">
        <span>🕐 <strong>Hora del servidor ahora:</strong>
          <code style="color:var(--accent);font-size:13px;"><?= esc($horaServidor) ?></code>
          (<?= esc($tzServidor) ?>, UTC<?= $offsetHoras >= 0 ? '+' : '' ?><?= $offsetHoras ?>h)
        </span>
        <span style="color:var(--muted);">|</span>
        <span>🇲🇽 <strong>Hora CDMX ahora:</strong>
          <code style="color:var(--green);font-size:13px;"><?= date('Y-m-d H:i:s', time() + ($cdmxOffset - $offsetHoras) * 3600) ?></code>
          (UTC-6)
        </span>
      </div>
      <?php if ($ajusteMsg): ?>
        <div style="margin-top:8px;padding:8px 12px;background:rgba(245,158,11,.1);border-radius:6px;font-size:12px;color:#fcd34d;">
          <?= $ajusteMsg ?>
        </div>
      <?php endif; ?>
    </div>

    <!-- Formulario de búsqueda -->
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title">🔍 Buscar en la Bitácora</div>
      <form method="GET" action="?tab=audit">
        <input type="hidden" name="tab" value="audit">
        <input type="hidden" name="buscar" value="1">

        <div class="grid-2" style="gap:14px;margin-bottom:14px;">
          <div>
            <label>📅 Fecha del incidente</label>
            <input type="date" name="q_fecha" value="<?= esc($bFecha) ?>">
          </div>
          <div>
            <label>⏰ Rango de hora (hora del servidor)</label>
            <div style="display:flex;gap:8px;align-items:center;">
              <input type="time" name="q_hora_d" value="<?= esc($bHoraD) ?>" style="flex:1;">
              <span style="color:var(--muted);">a</span>
              <input type="time" name="q_hora_h" value="<?= esc($bHoraH) ?>" style="flex:1;">
            </div>
          </div>
        </div>

        <div class="grid-2" style="gap:14px;margin-bottom:14px;">
          <div>
            <label>👤 Usuario (actor) — parcial o exacto</label>
            <input type="text" name="q_usuario" value="<?= esc($bUsuario) ?>" placeholder="Ej: manx, admin, CONSOLA_ADMIN">
          </div>
          <div>
            <label>🌐 Dirección IP</label>
            <input type="text" name="q_ip" value="<?= esc($bIP) ?>" placeholder="Ej: 187.170 o IP completa">
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <label>⚡ Tipo de acción (opcional)</label>
          <select name="q_accion" style="max-width:300px;">
            <option value="" <?= $bAccion==='' ?'selected':'' ?>>— Todas las acciones —</option>
            <option value="login"          <?= $bAccion==='login' ?'selected':'' ?>>🟢 login (entrada al sistema)</option>
            <option value="logout"         <?= $bAccion==='logout'?'selected':'' ?>>⚫ logout (cierre de sesión)</option>
            <option value="login_fail"     <?= $bAccion==='login_fail'?'selected':'' ?>>🔴 login_fail (intento fallido)</option>
            <option value="crear_usuario"  <?= $bAccion==='crear_usuario'?'selected':'' ?>>👤 crear_usuario</option>
            <option value="editar_usuario" <?= $bAccion==='editar_usuario'?'selected':'' ?>>✏️ editar_usuario</option>
            <option value="eliminar"       <?= str_contains($bAccion,'elimin')?'selected':'' ?>>🗑️ eliminar</option>
            <option value="save_circle"    <?= $bAccion==='save_circle'?'selected':'' ?>>📋 save_circle (círculo)</option>
            <option value="ac_"            <?= str_starts_with($bAccion,'ac_')?'selected':'' ?>>🛡️ acciones de consola admin</option>
          </select>
        </div>

        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <button type="submit" class="btn btn-orange">🔍 Buscar</button>
          <a href="?tab=audit" class="btn btn-ghost">✕ Limpiar filtros</a>
          <?php if ($busquedaActiva): ?>
            <span style="color:var(--muted);font-size:13px;">
              <?= $totalResultado ?> resultado<?= $totalResultado !== 1 ? 's' : '' ?>
              <?php if ($bDesde || $bHasta): ?>
                entre <code><?= esc($bDesde) ?></code> y <code><?= esc($bHasta) ?></code>
              <?php endif; ?>
            </span>
          <?php endif; ?>
        </div>
      </form>
    </div>

    <!-- Resultados de búsqueda -->
    <?php if ($busquedaActiva): ?>
    <div class="card">
      <div class="card-title">
        📊 Resultados
        <?php if ($totalResultado >= 200): ?>
          <span style="color:var(--yellow);font-size:11px;font-weight:normal;margin-left:8px;">⚠️ Mostrando primeros 200 — afina el rango de horas</span>
        <?php endif; ?>
      </div>
      <?php if (count($logsResultado) > 0): ?>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr><th>Hora servidor</th><th>Usuario</th><th>Acción</th><th>Objetivo</th><th>Detalle</th><th>IP origen</th></tr>
          </thead>
          <tbody>
            <?php foreach ($logsResultado as $log): ?>
            <?php
              $esLogin   = $log['accion'] === 'login';
              $esLogout  = $log['accion'] === 'logout';
              $esFail    = str_contains($log['accion'], 'fail') || str_contains($log['accion'], 'error');
              $esConsola = str_contains($log['accion'], 'ac_');
              $rowBg = $esFail ? 'rgba(239,68,68,.07)' : ($esLogin ? 'rgba(34,197,94,.05)' : ($esConsola ? 'rgba(249,115,22,.05)' : ''));
              $chipClass = $esFail ? 'chip-red' : ($esLogin ? 'chip-green' : ($esConsola ? 'chip-yellow' : 'chip-gray'));
            ?>
            <tr style="background:<?= $rowBg ?>">
              <td style="white-space:nowrap;">
                <strong style="color:var(--text);font-size:12px;"><?= esc(substr($log['created_at'] ?? '', 11, 8)) ?></strong>
                <br><span style="color:var(--muted);font-size:10px;"><?= esc(substr($log['created_at'] ?? '', 0, 10)) ?></span>
              </td>
              <td><code style="color:var(--blue);font-size:12px;"><?= esc($log['actor'] ?? '') ?></code></td>
              <td><span class="chip <?= $chipClass ?>"><?= esc($log['accion'] ?? '') ?></span></td>
              <td style="font-size:12px;color:var(--muted);"><?= esc($log['objetivo'] ?? '') ?></td>
              <td style="font-size:11px;color:var(--muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                  title="<?= esc($log['detalle'] ?? '') ?>">
                <?= esc(mb_substr($log['detalle'] ?? '', 0, 80)) ?>
              </td>
              <td style="font-size:12px;font-family:monospace;"><?= esc($log['ip'] ?? '') ?></td>
            </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
      <?php else: ?>
      <div style="text-align:center;padding:24px;color:var(--muted);">
        🔍 Sin resultados para los filtros seleccionados.<br>
        <span style="font-size:12px;">Verifica el rango de horas — recuerda que el servidor puede estar en una zona horaria diferente a CDMX.</span>
      </div>
      <?php endif; ?>
    </div>

    <?php else: ?>
    <!-- Vista por defecto: últimos 60 logs -->
    <div class="card">
      <div class="card-title">🕐 Últimas 60 acciones registradas</div>
      <?php if (count($recentLogs) > 0): ?>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Fecha/Hora</th><th>Usuario</th><th>Acción</th><th>Objetivo</th><th>Detalle</th><th>IP</th></tr></thead>
          <tbody>
            <?php foreach ($recentLogs as $log): ?>
            <?php
              $esConsola = str_contains($log['accion'], 'ac_');
              $esFail    = str_contains($log['accion'], 'fail') || str_contains($log['accion'], 'error');
              $esLogin   = $log['accion'] === 'login';
              $rowColor  = $esFail ? 'rgba(239,68,68,.07)' : ($esLogin ? 'rgba(34,197,94,.05)' : ($esConsola ? 'rgba(249,115,22,.05)' : ''));
              $chipClass = $esFail ? 'chip-red' : ($esLogin ? 'chip-green' : ($esConsola ? 'chip-yellow' : 'chip-gray'));
            ?>
            <tr style="background:<?= $rowColor ?>">
              <td style="white-space:nowrap;font-size:12px;"><?= fmtFecha($log['created_at'] ?? null) ?></td>
              <td><code style="font-size:12px;color:var(--blue)"><?= esc($log['actor'] ?? '') ?></code></td>
              <td><span class="chip <?= $chipClass ?>"><?= esc($log['accion'] ?? '') ?></span></td>
              <td style="font-size:12px"><?= esc($log['objetivo'] ?? '') ?></td>
              <td style="font-size:11px;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                  title="<?= esc($log['detalle'] ?? '') ?>"><?= esc(mb_substr($log['detalle'] ?? '', 0, 60)) ?></td>
              <td style="font-size:12px;color:var(--muted)"><?= esc($log['ip'] ?? '') ?></td>
            </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
      <?php else: ?>
      <p style="color:var(--muted);text-align:center;padding:16px;">Sin registros de auditoría disponibles.</p>
      <?php endif; ?>
    </div>
    <?php endif; ?>

    <div class="card">
      <div class="card-title">🗑️ Limpiar logs antiguos</div>
      <form method="POST" onsubmit="return confirm('¿Eliminar logs anteriores al período seleccionado?')">
        <input type="hidden" name="_csrf" value="<?= esc($csrf) ?>">
        <input type="hidden" name="ac_action" value="clean_audit_log">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <label style="margin:0;">Eliminar registros anteriores a:</label>
          <select name="dias" style="width:auto;">
            <option value="30">30 días</option>
            <option value="60">60 días</option>
            <option value="90" selected>90 días</option>
            <option value="180">6 meses</option>
            <option value="365">1 año</option>
          </select>
          <button type="submit" class="btn btn-red btn-sm">🗑️ Limpiar</button>
        </div>
      </form>
    </div>


    <!-- ══════════════ TAB: ANUNCIOS ══════════════ -->
    <?php elseif ($tab === 'announcement'): ?>
    <div class="page-title">📢 Anuncio Global</div>
    <div class="page-sub">Publica un mensaje visible para todos los usuarios conectados (vía heartbeat)</div>

    <?php if (!empty($announcement['activo'])): ?>
    <div class="alert alert-warn">
      📢 <strong>Anuncio activo</strong> — Tipo: <?= esc($announcement['tipo'] ?? '') ?><br>
      Mensaje: <em><?= esc($announcement['mensaje'] ?? '') ?></em><br>
      Publicado: <?= esc($announcement['desde'] ?? '') ?>
    </div>
    <?php endif; ?>

    <div class="card">
      <div class="card-title">✏️ Publicar anuncio</div>
      <form method="POST">
        <input type="hidden" name="_csrf" value="<?= esc($csrf) ?>">
        <input type="hidden" name="ac_action" value="set_announcement">
        <div class="grid-2">
          <div>
            <label>Mensaje</label>
            <textarea name="mensaje" rows="3" placeholder="Ej: El sistema tendrá mantenimiento el viernes a las 22:00h."><?= esc($announcement['mensaje'] ?? '') ?></textarea>
          </div>
          <div>
            <label>Tipo de alerta</label>
            <div class="grid-2" style="gap:8px;margin-top:4px;">
              <?php
                $tipos = [
                  'info'    => ['🔵','info',   'Informativo'],
                  'warning' => ['⚠️', 'yellow', 'Advertencia'],
                  'success' => ['✅','green',  'Éxito'],
                  'danger'  => ['🔴','red',    'Urgente'],
                ];
                foreach ($tipos as $val => [$icon, $color, $lbl]):
              ?>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin:0;">
                <input type="radio" name="tipo" value="<?= $val ?>" <?= ($announcement['tipo'] ?? 'info') === $val ? 'checked' : '' ?>>
                <?= $icon ?> <?= $lbl ?>
              </label>
              <?php endforeach; ?>
            </div>
            <br>
            <button type="submit" class="btn btn-blue">📢 Publicar anuncio</button>
          </div>
        </div>
      </form>
    </div>

    <?php if (!empty($announcement['activo'])): ?>
    <div class="card">
      <div class="card-title">🗑️ Eliminar anuncio actual</div>
      <form method="POST">
        <input type="hidden" name="_csrf" value="<?= esc($csrf) ?>">
        <input type="hidden" name="ac_action" value="set_announcement">
        <input type="hidden" name="mensaje" value="">
        <input type="hidden" name="tipo" value="info">
        <button type="submit" class="btn btn-ghost">🗑️ Eliminar anuncio</button>
      </form>
    </div>
    <?php endif; ?>


    <!-- ══════════════ TAB: EMERGENCIA ══════════════ -->
    <?php elseif ($tab === 'emergency'): ?>
    <div class="page-title">🚨 Herramientas de Emergencia</div>
    <div class="page-sub">Acciones críticas de último recurso. Úsalas solo cuando sea estrictamente necesario.</div>

    <div class="alert alert-warn">
      ⚠️ <strong>Zona de acciones de alto impacto.</strong> Cada acción queda registrada en la bitácora con tu IP y timestamp.
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">👤 Crear usuario superadmin de emergencia</div>
        <p style="color:var(--muted);font-size:12px;margin-bottom:12px;">
          Úsalo cuando el acceso al CRM está bloqueado porque el superadmin principal olvidó su contraseña o su cuenta fue bloqueada. El usuario se crea con rol <code>superadmin</code> y estado <code>Nacional</code>.
        </p>
        <form method="POST" onsubmit="return confirm('¿Crear usuario superadmin de emergencia?')">
          <input type="hidden" name="_csrf" value="<?= esc($csrf) ?>">
          <input type="hidden" name="ac_action" value="create_emergency_user">
          <label>Usuario</label>
          <input type="text" name="usuario" placeholder="admin_emergencia" required>
          <label>Nombre completo</label>
          <input type="text" name="nombre" placeholder="Admin Emergencia">
          <label>Contraseña</label>
          <input type="password" name="password" placeholder="Contraseña segura" required minlength="8">
          <br><br>
          <button type="submit" class="btn btn-red">🚨 Crear usuario de emergencia</button>
        </form>
      </div>

      <div class="card">
        <div class="card-title">📋 Checklist de emergencia</div>
        <ul style="list-style:none;padding:0;color:var(--muted);font-size:13px;line-height:2;">
          <li>✅ Antes de cambios en el servidor: activa modo Mantenimiento</li>
          <li>✅ Ante brecha de seguridad: fuerza cierre de sesiones (pestaña Mantenimiento)</li>
          <li>✅ Si superadmin está bloqueado: usa "Desbloquear usuario" (pestaña Usuarios)</li>
          <li>✅ Si superadmin olvidó contraseña: usa "Reset de contraseña" (pestaña Usuarios)</li>
          <li>✅ Si la cuenta no existe: crea usuario de emergencia (esta pestaña)</li>
          <li>✅ Después de resolver: desactiva el modo de mantenimiento</li>
          <li>✅ Después de resolver: elimina el usuario de emergencia desde el CRM</li>
        </ul>
      </div>
    </div>

    <?php endif; ?>

  </main>
</div><!-- /layout -->

<script>
function selectModo(modo) {
  document.getElementById('modoInput').value = modo;
  document.getElementById('mcard-banner').classList.toggle('selected',  modo === 'banner');
  document.getElementById('mcard-bloqueo').classList.toggle('selected', modo === 'bloqueo');
}
// Pre-seleccionar el modo actual
(function() {
  const actual = '<?= esc($mantenimiento['modo'] ?? 'banner') ?>';
  selectModo(actual);
})();
</script>

<?php endif; // autenticado ?>
</body>
</html>

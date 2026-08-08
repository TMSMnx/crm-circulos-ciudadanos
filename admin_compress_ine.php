<?php
/**
 * admin_compress_ine.php
 * Herramienta de administración: recomprime y redimensiona imágenes INE
 * guardadas en uploads/ que superen los límites (800×520, 150 KB).
 *
 * Acceso: solo sesión activa con rol developer / coordinador_nacional / admin
 * URL:    https://circulosciudadanos.mx/admin_compress_ine.php
 */

ini_set('memory_limit',      '512M');
ini_set('max_execution_time', '300');
error_reporting(0);

// Configuración de sesión idéntica a api.php para compartir la misma sesión
ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_samesite', 'Strict');
ini_set('session.use_strict_mode', 1);
if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
    ini_set('session.cookie_secure', 1);
}

session_start();

// ── Auth ──────────────────────────────────────────────────────────────────────
$rolesPermitidos = ['developer', 'coordinador_nacional', 'admin'];
if (empty($_SESSION['is_logged_in']) || !in_array($_SESSION['rol'] ?? '', $rolesPermitidos, true)) {
    http_response_code(403);
    echo '<h2 style="font-family:sans-serif;color:red">403 — Acceso denegado. Inicia sesión como administrador.</h2>';
    exit;
}

require_once 'db.php';   // $pdo disponible

// ── Configuración de límites (igual que ocr-engine.js) ────────────────────────
define('MAX_W',        800);
define('MAX_H',        520);
define('JPEG_QUALITY',  75);   // Calidad base — texto de documentos sigue legible
define('JPEG_QUALITY_2', 60);  // Segunda pasada si aún excede el límite
define('MAX_KB',       150);
define('GRAY_RATIO',  0.95);   // Si saturación media < 5% → tratar como B&N

// ── Acción ────────────────────────────────────────────────────────────────────
$runMode = $_POST['run'] ?? '';

// ── Helpers ───────────────────────────────────────────────────────────────────
function humanKB(int $bytes): string {
    return round($bytes / 1024, 1) . ' KB';
}

/**
 * Detecta si una imagen GD es esencialmente B&N (escala de grises).
 * Muestra una muestra de 500 píxeles distribuidos y compara R,G,B.
 * Retorna true si la saturación media es < 5%.
 */
function esImagenGris($img): bool {
    $w = imagesx($img);
    $h = imagesy($img);
    $muestras = 500;
    $diferencia = 0;
    for ($i = 0; $i < $muestras; $i++) {
        $px  = imagecolorat($img, rand(0, $w - 1), rand(0, $h - 1));
        $r   = ($px >> 16) & 0xFF;
        $g   = ($px >>  8) & 0xFF;
        $b   =  $px        & 0xFF;
        $max = max($r, $g, $b);
        $min = min($r, $g, $b);
        // Saturación HSV = (max-min)/max  (0-255 scale)
        $diferencia += ($max > 0) ? (($max - $min) / $max) : 0;
    }
    return ($diferencia / $muestras) < 0.05;   // < 5% de saturación media
}

/**
 * Recomprime un archivo de imagen en disco.
 * Aplica escala de grises automática para credenciales B&N.
 * Devuelve ['ok'=>bool, 'antes'=>int, 'despues'=>int, 'msg'=>string]
 */
function recomprimir(string $filePath): array {
    if (!file_exists($filePath) || !is_readable($filePath)) {
        return ['ok' => false, 'antes' => 0, 'despues' => 0, 'msg' => 'Archivo no encontrado'];
    }

    $antes = filesize($filePath);

    // Solo procesar si supera el límite
    if ($antes <= MAX_KB * 1024) {
        return ['ok' => true, 'antes' => $antes, 'despues' => $antes, 'msg' => 'OK (ya cumple límite)'];
    }

    // Detectar tipo
    $info = @getimagesize($filePath);
    if (!$info) return ['ok' => false, 'antes' => $antes, 'despues' => $antes, 'msg' => 'No es imagen válida'];

    $mime = $info['mime'];
    $img  = null;

    if     ($mime === 'image/jpeg') $img = @imagecreatefromjpeg($filePath);
    elseif ($mime === 'image/png')  $img = @imagecreatefrompng($filePath);
    elseif ($mime === 'image/webp') $img = @imagecreatefromwebp($filePath);

    if (!$img) return ['ok' => false, 'antes' => $antes, 'despues' => $antes, 'msg' => 'GD no pudo leer la imagen'];

    $w = imagesx($img);
    $h = imagesy($img);

    // ── Paso 1: Convertir a escala de grises si la imagen es B&N ──────────────
    // Para INEs escaneados en blanco y negro esto reduce el JPEG un 30-40%
    // porque los canales Cb/Cr del YCbCr quedan uniformes y comprimen a casi 0.
    $esGris = esImagenGris($img);
    $notaGris = '';
    if ($esGris) {
        imagefilter($img, IMG_FILTER_GRAYSCALE);
        $notaGris = ' [→ Grises]';
    }

    // ── Paso 2: Redimensionar si supera límites ────────────────────────────────
    $ratio = min(MAX_W / $w, MAX_H / $h, 1.0);
    if ($ratio < 1.0) {
        $nw = (int) round($w * $ratio);
        $nh = (int) round($h * $ratio);
        $tmp = imagecreatetruecolor($nw, $nh);
        imagefill($tmp, 0, 0, imagecolorallocate($tmp, 255, 255, 255));
        imagecopyresampled($tmp, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
        imagedestroy($img);
        $img = $tmp;
        if ($esGris) imagefilter($img, IMG_FILTER_GRAYSCALE);  // mantener después del resize
    }

    // ── Paso 3: Guardar como JPEG (calidad 75) ────────────────────────────────
    $newPath = preg_replace('/\.(png|webp|jpg|jpeg)$/i', '.jpg', $filePath);
    ob_start();
    $saved = @imagejpeg($img, null, JPEG_QUALITY);
    $jpegData = ob_get_clean();
    if ($saved) file_put_contents($newPath, $jpegData);

    // ── Paso 4: Si aún excede el límite, segunda pasada con calidad 60 ─────────
    if ($saved && strlen($jpegData) > MAX_KB * 1024) {
        ob_start();
        @imagejpeg($img, null, JPEG_QUALITY_2);
        $jpegData2 = ob_get_clean();
        if (strlen($jpegData2) < strlen($jpegData)) {
            file_put_contents($newPath, $jpegData2);
            $notaGris .= ' [Q60]';
        }
    }

    imagedestroy($img);

    if (!$saved) return ['ok' => false, 'antes' => $antes, 'despues' => $antes, 'msg' => 'GD no pudo guardar'];

    // Si cambió extensión, eliminar original
    if ($newPath !== $filePath) {
        @unlink($filePath);
    }

    $despues = filesize($newPath);
    return ['ok' => true, 'antes' => $antes, 'despues' => $despues, 'msg' => 'Comprimida' . $notaGris, 'newPath' => $newPath];
}

// ── Escanear BD ───────────────────────────────────────────────────────────────
$totalCirculos = 0;
$totalImagenes = 0;
$imagenesGrandes = [];   // [uid, cedula_nombre, campo, path, antes_kb]
$base = __DIR__ . '/';

$stmt = $pdo->query("SELECT unique_id, data FROM circles");
while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    $totalCirculos++;
    $circle = json_decode($row['data'], true);
    if (!$circle) continue;

    $uid = $row['unique_id'];
    foreach (($circle['cedulas'] ?? []) as $ced) {
        $nombre = $ced['nombre'] ?? 'Sin nombre';
        foreach (['ine_data', 'foto_perfil'] as $campo) {
            if (empty($ced[$campo])) continue;
            $val = $ced[$campo];

            // Base64 almacenado directamente en BD
            if (strpos($val, 'data:image') === 0) {
                $kb = (int)(strlen($val) * 0.75 / 1024);
                $totalImagenes++;
                if ($kb > MAX_KB) {
                    $imagenesGrandes[] = [
                        'uid'    => $uid,
                        'nombre' => $nombre,
                        'campo'  => $campo,
                        'path'   => '(base64 en BD)',
                        'kb'     => $kb,
                        'tipo'   => 'base64',
                        'b64raw' => $val     // guardamos el dato para poder recomprimirlo
                    ];
                }
                continue;
            }

            // Es ruta de archivo
            $path = $base . ltrim($val, '/');
            if (!file_exists($path)) continue;

            $totalImagenes++;
            $kb = (int)(filesize($path) / 1024);

            if ($kb > MAX_KB) {
                $imagenesGrandes[] = [
                    'uid'    => $uid,
                    'nombre' => $nombre,
                    'campo'  => $campo,
                    'path'   => $path,
                    'relPath'=> $val,
                    'kb'     => $kb,
                    'tipo'   => 'file'
                ];
            }
        }
    }
}

// ── Ejecutar compresión ───────────────────────────────────────────────────────
$resultados = [];
$ahorroTotal = 0;

if ($runMode === '1' && !empty($imagenesGrandes)) {
    foreach ($imagenesGrandes as $item) {

        // ── Caso especial: base64 almacenado directamente en BD ────────────────
        if ($item['tipo'] === 'base64') {
            // Recomprimir el base64 directamente en memoria
            $b64raw = $item['b64raw'] ?? '';
            if (!$b64raw) {
                $resultados[] = $item + ['ok' => false, 'despues' => $item['kb'], 'msg' => 'Base64 no disponible'];
                continue;
            }
            $binData = @base64_decode(preg_replace('/^data:image\/\w+;base64,/', '', $b64raw));
            $imgB64  = $binData ? @imagecreatefromstring($binData) : null;
            if (!$imgB64) {
                $resultados[] = $item + ['ok' => false, 'despues' => $item['kb'], 'msg' => 'No se pudo decodificar base64'];
                continue;
            }
            // Redimensionar
            $bw = imagesx($imgB64); $bh = imagesy($imgB64);
            $ratio = min(MAX_W / $bw, MAX_H / $bh, 1.0);
            if ($ratio < 1.0) {
                $nw = (int)round($bw * $ratio); $nh = (int)round($bh * $ratio);
                $tmp = imagecreatetruecolor($nw, $nh);
                imagefill($tmp, 0, 0, imagecolorallocate($tmp, 255, 255, 255));
                imagecopyresampled($tmp, $imgB64, 0, 0, 0, 0, $nw, $nh, $bw, $bh);
                imagedestroy($imgB64); $imgB64 = $tmp;
            }
            // Grayscale si B&N
            if (esImagenGris($imgB64)) imagefilter($imgB64, IMG_FILTER_GRAYSCALE);
            ob_start(); imagejpeg($imgB64, null, JPEG_QUALITY); $newBin = ob_get_clean();
            imagedestroy($imgB64);
            $newB64 = 'data:image/jpeg;base64,' . base64_encode($newBin);
            $newKb  = (int)(strlen($newB64) * 0.75 / 1024);

            // Actualizar BD
            $stmtCircle = $pdo->prepare("SELECT data FROM circles WHERE unique_id = ? LIMIT 1");
            $stmtCircle->execute([$item['uid']]);
            $rowC = $stmtCircle->fetch(PDO::FETCH_ASSOC);
            if ($rowC) {
                $circleData = $rowC['data'];
                $circleData = str_replace($b64raw, $newB64, $circleData);
                $pdo->prepare("UPDATE circles SET data = ? WHERE unique_id = ?")->execute([$circleData, $item['uid']]);
            }

            $ahorro = $item['kb'] - $newKb;
            $ahorroTotal += max(0, $ahorro);
            $resultados[] = $item + ['ok' => true, 'despues' => $newKb * 1024, 'msg' => 'Base64 recomprimida en BD', 'ahorro_kb' => $ahorro];
            continue;
        }

        $res = recomprimir($item['path']);
        $ahorro = $item['kb'] - round($res['despues'] / 1024, 1);
        $ahorroTotal += max(0, $ahorro);

        // Si cambió la extensión del archivo, actualizar el path en la BD
        $newRelPath = $item['relPath'];
        if (!empty($res['newPath']) && $res['newPath'] !== $item['path']) {
            $newRelPath = 'uploads/' . substr($res['newPath'], strpos($res['newPath'], 'uploads/') + 8);

            // Actualizar el JSON del círculo en BD
            $stmtCircle = $pdo->prepare("SELECT data FROM circles WHERE unique_id = ? LIMIT 1");
            $stmtCircle->execute([$item['uid']]);
            $rowC = $stmtCircle->fetch(PDO::FETCH_ASSOC);
            if ($rowC) {
                $circleData = $rowC['data'];
                $circleData = str_replace(json_encode($item['relPath']), json_encode($newRelPath), $circleData);
                $pdo->prepare("UPDATE circles SET data = ? WHERE unique_id = ?")->execute([$circleData, $item['uid']]);
            }
        }

        $resultados[] = $item + $res + ['ahorro_kb' => round($ahorro, 1)];
    }
}

// ── HTML ──────────────────────────────────────────────────────────────────────
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Compresor INE — Admin CRM</title>
<style>
  body { font-family: 'Segoe UI', sans-serif; background: #f0f2f5; margin: 0; padding: 20px; color: #333; }
  .card { background: #fff; border-radius: 12px; padding: 24px; max-width: 900px; margin: 0 auto 20px; box-shadow: 0 2px 8px rgba(0,0,0,.1); }
  h1 { color: #1a237e; margin: 0 0 8px; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; }
  .green  { background: #e8f5e9; color: #2e7d32; }
  .orange { background: #fff3e0; color: #e65100; }
  .red    { background: #ffebee; color: #c62828; }
  .blue   { background: #e3f2fd; color: #1565c0; }
  table   { width: 100%; border-collapse: collapse; font-size: 13px; }
  th      { background: #1a237e; color: #fff; padding: 8px 10px; text-align: left; }
  td      { padding: 7px 10px; border-bottom: 1px solid #eee; }
  tr:hover td { background: #f5f7ff; }
  .btn    { display: inline-block; padding: 12px 24px; border-radius: 8px; border: none; cursor: pointer; font-size: 15px; font-weight: 600; }
  .btn-primary { background: #1a237e; color: #fff; }
  .btn-danger  { background: #c62828; color: #fff; }
  .btn:hover   { opacity: .85; }
  .stat   { font-size: 32px; font-weight: 700; color: #1a237e; }
  .sub    { font-size: 13px; color: #666; }
  .grid   { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin: 16px 0; }
  .stat-box { text-align: center; background: #f5f7ff; border-radius: 8px; padding: 16px; }
</style>
</head>
<body>

<div class="card" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
  <div>
    <h1 style="margin:0 0 6px">🗜️ Compresor Masivo de Imágenes INE</h1>
    <p style="color:#555; margin:0 0 8px">Reduce imágenes grandes en <code>uploads/</code> al estándar: máx. <strong>800×520 px</strong>, JPEG q75 (q60 segunda pasada), <strong>150 KB</strong>. Auto-convierte a escala de grises las fotos B&amp;N.</p>
    <p style="margin:0"><span class="badge blue">Usuario: <?= htmlspecialchars($_SESSION['usuario'] ?? '') ?></span>
       <span class="badge blue" style="margin-left:8px">Rol: <?= htmlspecialchars($_SESSION['rol'] ?? '') ?></span></p>
  </div>
  <a href="index.html" class="btn btn-primary" style="white-space:nowrap; text-decoration:none;">← Volver al CRM</a>
</div>

<div class="card">
  <h2 style="margin:0 0 16px">📊 Resumen del escaneo</h2>
  <div class="grid">
    <div class="stat-box">
      <div class="stat"><?= $totalCirculos ?></div>
      <div class="sub">Círculos totales</div>
    </div>
    <div class="stat-box">
      <div class="stat"><?= $totalImagenes ?></div>
      <div class="sub">Imágenes encontradas</div>
    </div>
    <div class="stat-box">
      <div class="stat" style="color:<?= count($imagenesGrandes) > 0 ? '#c62828' : '#2e7d32' ?>">
        <?= count($imagenesGrandes) ?>
      </div>
      <div class="sub">Imágenes que superan 150 KB</div>
    </div>
    <div class="stat-box">
      <div class="stat" style="color:#e65100">
        <?= round(array_sum(array_column($imagenesGrandes, 'kb')) / 1024, 1) ?> MB
      </div>
      <div class="sub">Peso total a comprimir</div>
    </div>
  </div>
</div>

<?php if (!empty($imagenesGrandes) && $runMode !== '1'): ?>
<div class="card">
  <h2 style="margin:0 0 16px">⚠️ Imágenes que requieren compresión</h2>
  <table>
    <tr><th>Círculo</th><th>Integrante</th><th>Campo</th><th>Tipo</th><th>Tamaño actual</th></tr>
    <?php foreach ($imagenesGrandes as $img): ?>
    <tr>
      <td style="font-size:11px;color:#888"><?= htmlspecialchars(substr($img['uid'], 0, 20)) ?>...</td>
      <td><?= htmlspecialchars($img['nombre']) ?></td>
      <td><span class="badge <?= $img['campo'] === 'ine_data' ? 'orange' : 'blue' ?>"><?= $img['campo'] ?></span></td>
      <td>
        <?php if ($img['tipo'] === 'base64'): ?>
          <span class="badge blue">BD base64</span>
        <?php else: ?>
          <span class="badge green">Archivo</span>
        <?php endif; ?>
      </td>
      <td><span class="badge red"><?= number_format($img['kb']) ?> KB <?= $img['kb'] > 1024 ? '('.round($img['kb']/1024,1).' MB)' : '' ?></span></td>
    </tr>
    <?php endforeach; ?>
  </table>

  <form method="POST" style="margin-top:20px" onsubmit="return confirm('¿Comprimir <?= count($imagenesGrandes) ?> imágenes?\n\nEsta acción modifica los archivos en el servidor y las entradas base64 en la BD.\n\nSe recomienda tener un backup de uploads/ antes de continuar.')">
    <input type="hidden" name="run" value="1">
    <button type="submit" class="btn btn-danger">
      🗜️ Comprimir <?= count($imagenesGrandes) ?> imágenes ahora
    </button>
    <p style="font-size:12px;color:#888;margin-top:8px">
      ⚠️ Archivos en disco se sobrescribirán. Imágenes B&amp;N se convertirán a escala de grises (30-40% más pequeñas). Imágenes base64 en BD se recomprimirán en memoria.
    </p>
  </form>
</div>
<?php endif; ?>

<?php if ($runMode === '1' && !empty($resultados)): ?>
<div class="card">
  <h2 style="margin:0 0 16px">✅ Resultados de la compresión</h2>
  <p><strong>Ahorro total estimado: <?= round($ahorroTotal, 1) ?> KB (<?= round($ahorroTotal / 1024, 2) ?> MB)</strong></p>
  <table>
    <tr><th>Integrante</th><th>Campo</th><th>Antes</th><th>Después</th><th>Ahorro</th><th>Estado</th></tr>
    <?php foreach ($resultados as $r): ?>
    <tr>
      <td><?= htmlspecialchars($r['nombre']) ?></td>
      <td><?= htmlspecialchars($r['campo']) ?></td>
      <td><span class="badge red"><?= $r['kb'] ?> KB</span></td>
      <td><span class="badge <?= ($r['despues'] ?? $r['kb']*1024) <= MAX_KB*1024 ? 'green' : 'orange' ?>">
        <?= round(($r['despues'] ?? $r['kb']*1024) / 1024, 1) ?> KB
      </span></td>
      <td><?= isset($r['ahorro_kb']) ? $r['ahorro_kb'] . ' KB' : '—' ?></td>
      <td><span class="badge <?= ($r['ok'] ?? false) ? 'green' : 'red' ?>"><?= htmlspecialchars($r['msg'] ?? '') ?></span></td>
    </tr>
    <?php endforeach; ?>
  </table>
  <p style="margin-top:16px"><a href="admin_compress_ine.php" style="color:#1a237e">↺ Volver a escanear</a></p>
</div>
<?php endif; ?>

<?php if (empty($imagenesGrandes) && $runMode !== '1'): ?>
<div class="card">
  <p style="color:#2e7d32;font-size:18px">✅ <strong>Todas las imágenes cumplen el límite de 150 KB.</strong> No hay nada que comprimir.</p>
</div>
<?php endif; ?>

<div class="card" style="font-size:12px;color:#888">
  <strong>Nota técnica:</strong> Solo se procesan imágenes almacenadas como archivos en <code>uploads/</code>.
  Las imágenes base64 antiguas en la BD no se pueden comprimir automáticamente — aparecen marcadas en la lista.
  Al re-subir el INE desde la app, el sistema automáticamente las comprimirá y almacenará como archivo.
</div>

</body>
</html>

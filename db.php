<?php
// db.php - Conector Seguro v12.0
$secrets_path = __DIR__ . '/../crm_secrets.php';
if (!file_exists($secrets_path)) {
    $secrets_path = __DIR__ . '/crm_secrets.php';
}

if (!file_exists($secrets_path)) {
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Error de configuración del servidor.']);
    exit;
}

require_once $secrets_path;

try {
    $pdo = new PDO(
        "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]
    );
} catch (PDOException $e) {
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Error de conexión al servidor de datos.']);
    exit;
}

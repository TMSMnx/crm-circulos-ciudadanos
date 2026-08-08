<?php
// Prueba de vida del servidor
error_reporting(E_ALL);
ini_set('display_errors', 1);

echo "<h3>1. PHP Funciona: SI</h3>";

if (file_exists('db.php')) {
    echo "<h3>2. Archivo db.php encontrado: SI</h3>";
    require 'db.php';
    if (isset($pdo)) {
        echo "<h3>3. Conexión Base de Datos: EXITOSA</h3>";
    } else {
        echo "<h3>3. Conexión Base de Datos: FALLÓ (Variable pdo no existe)</h3>";
    }
} else {
    echo "<h3>2. Archivo db.php encontrado: NO (Revisa que api.php y db.php estén juntos)</h3>";
}
?>
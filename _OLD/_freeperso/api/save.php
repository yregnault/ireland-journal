<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('HTTP/1.1 204 No Content');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('HTTP/1.1 405 Method Not Allowed');
    echo '{"error":"POST only"}';
    exit;
}

// Lire le body POST (compatible PHP 4)
$input = '';
$ph = fopen('php://input', 'r');
if ($ph) {
    while (!feof($ph)) {
        $input .= fread($ph, 8192);
    }
    fclose($ph);
}

if (strlen($input) < 2) {
    header('HTTP/1.1 400 Bad Request');
    echo '{"error":"Body vide"}';
    exit;
}

$dir = dirname(__FILE__) . '/../data';
if (!is_dir($dir)) {
    mkdir($dir, 0755);
}

$file = $dir . '/journal.json';
$fp = fopen($file, 'w');
if ($fp) {
    fwrite($fp, $input);
    fclose($fp);
    echo '{"ok":true,"size":' . strlen($input) . '}';
} else {
    header('HTTP/1.1 500 Internal Server Error');
    echo '{"error":"Impossible d ecrire le fichier"}';
}
?>
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

// Lire le body POST
$input = '';
$ph = fopen('php://input', 'r');
if ($ph) {
    while (!feof($ph)) {
        $input .= fread($ph, 8192);
    }
    fclose($ph);
}

// Extraire filename et base64 du JSON
$filename = '';
$base64 = '';

if (preg_match('/"filename"\s*:\s*"([^"]*)"/', $input, $m)) {
    $filename = $m[1];
}
if (preg_match('/"base64"\s*:\s*"([^"]*)"/', $input, $m)) {
    $base64 = $m[1];
}

if ($filename === '' || $base64 === '') {
    header('HTTP/1.1 400 Bad Request');
    echo '{"error":"Champs base64 et filename requis"}';
    exit;
}

$filename = preg_replace('/[^a-zA-Z0-9._-]/', '', $filename);
if ($filename === '') {
    $filename = time() . '.jpg';
}

$dir = dirname(__FILE__) . '/../photos';
if (!is_dir($dir)) {
    mkdir($dir, 0755);
}

$filepath = $dir . '/' . $filename;
$bytes = base64_decode($base64);

if ($bytes === false) {
    header('HTTP/1.1 400 Bad Request');
    echo '{"error":"Base64 invalide"}';
    exit;
}

$fp = fopen($filepath, 'wb');
if ($fp) {
    fwrite($fp, $bytes);
    fclose($fp);
    $host = $_SERVER['HTTP_HOST'];
    $base = dirname(dirname($_SERVER['SCRIPT_NAME']));
    $url = 'http://' . $host . rtrim($base, '/') . '/photos/' . $filename;
    echo '{"ok":true,"url":"' . $url . '","size":' . strlen($bytes) . '}';
} else {
    header('HTTP/1.1 500 Internal Server Error');
    echo '{"error":"Impossible d ecrire le fichier"}';
}
?>
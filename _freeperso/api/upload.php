<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST only']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

if (!$input || !isset($input['base64']) || !isset($input['filename'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Champs base64 et filename requis']);
    exit;
}

// Sécurité : nettoyer le nom de fichier
$filename = preg_replace('/[^a-zA-Z0-9._-]/', '', $input['filename']);
if (empty($filename)) $filename = time() . '.jpg';

$dir = __DIR__ . '/../photos';
if (!is_dir($dir)) mkdir($dir, 0755, true);

$filepath = $dir . '/' . $filename;
$bytes = base64_decode($input['base64']);

if ($bytes === false) {
    http_response_code(400);
    echo json_encode(['error' => 'Base64 invalide']);
    exit;
}

file_put_contents($filepath, $bytes);

// Construire l'URL publique
$host = $_SERVER['HTTP_HOST'];
$base = dirname(dirname($_SERVER['SCRIPT_NAME']));
$url = 'http://' . $host . $base . '/photos/' . $filename;

echo json_encode(['ok' => true, 'url' => $url, 'size' => strlen($bytes)]);
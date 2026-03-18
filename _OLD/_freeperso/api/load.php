<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('HTTP/1.1 204 No Content');
    exit;
}

$file = dirname(__FILE__) . '/../data/journal.json';

if (file_exists($file)) {
    $fp = fopen($file, 'r');
    if ($fp) {
        $size = filesize($file);
        if ($size > 0) {
            $content = fread($fp, $size);
            echo $content;
        } else {
            echo 'null';
        }
        fclose($fp);
    } else {
        echo 'null';
    }
} else {
    echo 'null';
}
?>
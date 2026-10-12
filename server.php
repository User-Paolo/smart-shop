<?php
declare(strict_types=1);


$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if (str_starts_with($path, '/api/') || $path === '/api') {
    require __DIR__ . '/backend/public/index.php';
    return true;
}

$frontend = realpath(__DIR__ . '/frontend');
$file     = realpath($frontend . ($path === '/' ? '/index.html' : $path));

// Only serve files that really live inside frontend/
if ($file === false || !str_starts_with($file, $frontend) || !is_file($file)) {
    http_response_code(404);
    echo 'Not found';
    return true;
}

$types = [
    'html' => 'text/html; charset=utf-8',
    'css'  => 'text/css; charset=utf-8',
    'js'   => 'text/javascript; charset=utf-8',
    'json' => 'application/json',
    'svg'  => 'image/svg+xml',
    'png'  => 'image/png',
    'ico'  => 'image/x-icon',
    'map'  => 'application/json',
];
$ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
header('X-Content-Type-Options: nosniff');
if ($ext === 'html') {
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}
readfile($file);
return true;

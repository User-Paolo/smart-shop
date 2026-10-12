<?php
declare(strict_types=1);

$env = static fn (string $name, string $default): string => getenv($name) !== false ? getenv($name) : $default;

return [
    'db' => [
        'host'     => $env('DB_HOST', '127.0.0.1'),
        'port'     => (int) $env('DB_PORT', '3306'),
        'name'     => $env('DB_NAME', 'smart_shop'),
        'user'     => $env('DB_USER', 'shop_app'),
        'password' => $env('DB_PASSWORD', 'shop_pass'),
    ],
    'jwt' => [
        'secret' => $env('JWT_SECRET', 'dev-only-secret-change-me-0123456789abcdef'),
        'ttl'    => 60 * 60 * 8,
    ],
    'login' => [
        'max_failures'   => 5,
        'window_minutes' => 15,
    ],
    'analytics' => [
        'python'      => $env('PYTHON_BIN', PHP_OS_FAMILY === 'Windows' ? 'python' : 'python3'),
        'script'      => dirname(__DIR__, 2) . '/analytics/forecast.py',
        'status_file' => dirname(__DIR__) . '/storage/forecast_status.json',
        'log_file'    => dirname(__DIR__) . '/storage/logs/forecast.log',
    ],
    'risk' => [
        'high_ratio'   => 1.0,
        'medium_ratio' => 0.7,
    ],
];

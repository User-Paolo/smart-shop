<?php
declare(strict_types=1);

spl_autoload_register(static function (string $class): void {
    if (str_starts_with($class, 'App\\')) {
        $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, 4)) . '.php';
        if (is_file($file)) {
            require $file;
        }
    }
});

date_default_timezone_set(getenv('APP_TIMEZONE') ?: 'Europe/Athens');

function config(string $key): mixed
{
    static $values = null;
    $values ??= require __DIR__ . '/../config/config.php';
    return $values[$key] ?? null;
}

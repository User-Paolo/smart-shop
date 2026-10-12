<?php
declare(strict_types=1);


use App\Core\Auth;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Router;

require __DIR__ . '/../src/bootstrap.php';

ini_set('display_errors', '0');
error_reporting(E_ALL);

try {
    $request = Request::fromGlobals();

    $router = new Router();
    (require __DIR__ . '/../src/routes.php')($router);

    $response = $router->dispatch($request, new Auth());
} catch (HttpException $e) {
    $response = Response::error($e->status, $e->getMessage(), $e->errors);
} catch (\PDOException $e) {
    error_log('[DB] ' . $e->getMessage());
    $response = Response::error(500, 'A database error occurred.');
} catch (\Throwable $e) {
    error_log('[APP] ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    $response = Response::error(500, 'Internal server error.');
}

$response->send();

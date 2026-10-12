<?php
declare(strict_types=1);

use App\Controllers\CartController;
use App\Controllers\ForecastController;
use App\Controllers\OrderController;
use App\Controllers\ProductController;
use App\Controllers\UserController;
use App\Core\Router;

return static function (Router $r): void {
    $r->post('/api/auth/register', [UserController::class, 'register']);
    $r->post('/api/auth/login',    [UserController::class, 'login']);
    $r->get('/api/auth/me',        [UserController::class, 'me'], ['auth']);

    $r->patch('/api/users/me',                 [UserController::class, 'updateMe'], ['auth']);
    $r->get('/api/admin/users',                [UserController::class, 'index'],    ['admin']);
    $r->get('/api/admin/users/{id}',           [UserController::class, 'show'],     ['admin']);
    $r->patch('/api/admin/users/{id}/role',    [UserController::class, 'setRole'],  ['admin']);
    $r->delete('/api/admin/users/{id}',        [UserController::class, 'destroy'],  ['admin']);

    $r->get('/api/categories',     [ProductController::class, 'categories']);
    $r->get('/api/products',       [ProductController::class, 'index']);
    $r->get('/api/products/{id}',  [ProductController::class, 'show']);

    $r->get('/api/admin/products',              [ProductController::class, 'adminIndex'],  ['admin']);
    $r->post('/api/admin/products',             [ProductController::class, 'store'],       ['admin']);
    $r->put('/api/admin/products/{id}',         [ProductController::class, 'update'],      ['admin']);
    $r->patch('/api/admin/products/{id}',       [ProductController::class, 'update'],      ['admin']);
    $r->post('/api/admin/products/{id}/stock',  [ProductController::class, 'adjustStock'], ['admin']);
    $r->delete('/api/admin/products/{id}',      [ProductController::class, 'destroy'],     ['admin']);

    $r->get('/api/cart',                       [CartController::class, 'show'],   ['auth']);
    $r->post('/api/cart/items',                [CartController::class, 'add'],    ['auth']);
    $r->patch('/api/cart/items/{productId}',   [CartController::class, 'update'], ['auth']);
    $r->delete('/api/cart/items/{productId}',  [CartController::class, 'remove'], ['auth']);

    $r->post('/api/orders',                      [OrderController::class, 'checkout'],     ['auth']);
    $r->get('/api/orders',                       [OrderController::class, 'mine'],         ['auth']);
    $r->get('/api/orders/{id}',                  [OrderController::class, 'show'],         ['auth']);
    $r->get('/api/admin/orders',                 [OrderController::class, 'adminIndex'],   ['admin']);
    $r->patch('/api/admin/orders/{id}/status',   [OrderController::class, 'updateStatus'], ['admin']);

    $r->get('/api/admin/forecasts',                        [ForecastController::class, 'index'],   ['admin']);
    $r->get('/api/admin/forecasts/status',                 [ForecastController::class, 'status'],  ['admin']);
    $r->post('/api/admin/forecasts/run',                   [ForecastController::class, 'run'],     ['admin']);
    $r->get('/api/admin/forecasts/{productId}/history',    [ForecastController::class, 'history'], ['admin']);
    $r->post('/api/admin/forecasts/{productId}/restock',   [ForecastController::class, 'restock'], ['admin']);
};

<?php
declare(strict_types=1);

namespace App\Core;

final class Router
{
    private array $routes = [];

    public function get(string $path, array $handler, array $mw = []): void    { $this->add('GET', $path, $handler, $mw); }
    public function post(string $path, array $handler, array $mw = []): void   { $this->add('POST', $path, $handler, $mw); }
    public function put(string $path, array $handler, array $mw = []): void    { $this->add('PUT', $path, $handler, $mw); }
    public function patch(string $path, array $handler, array $mw = []): void  { $this->add('PATCH', $path, $handler, $mw); }
    public function delete(string $path, array $handler, array $mw = []): void { $this->add('DELETE', $path, $handler, $mw); }

    private function add(string $method, string $path, array $handler, array $middleware): void
    {
        $pattern = '#^' . preg_replace('#\{([a-zA-Z_]+)\}#', '(?P<$1>[^/]+)', $path) . '$#';
        $this->routes[] = compact('method', 'pattern', 'handler', 'middleware');
    }

    public function dispatch(Request $request, Auth $auth): Response
    {
        $pathMatched = false;

        foreach ($this->routes as $route) {
            if (!preg_match($route['pattern'], $request->path, $matches)) {
                continue;
            }
            $pathMatched = true;
            if ($route['method'] !== $request->method) {
                continue;
            }

            $params  = array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);
            $request = $request->withParams($params);

            foreach ($route['middleware'] as $mw) {
                match ($mw) {
                    'auth'  => $auth->requireUser($request),
                    'admin' => $auth->requireAdmin($request),
                    default => throw new \LogicException("Unknown middleware {$mw}"),
                };
            }

            [$class, $method] = $route['handler'];
            return (new $class())->$method($request);
        }

        throw $pathMatched
            ? new HttpException(405, 'Method not allowed.')
            : new HttpException(404, 'Endpoint not found.');
    }
}

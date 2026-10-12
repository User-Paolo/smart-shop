<?php
declare(strict_types=1);

namespace App\Core;

final class Request
{
    private array $params = [];

    public ?array $user = null;

    private function __construct(
        public readonly string $method,
        public readonly string $path,
        private readonly array $query,
        private readonly array $body,
        private readonly array $headers
    ) {
    }

    public static function fromGlobals(): self
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $path   = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $path   = rtrim($path, '/') ?: '/';

        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (str_starts_with($key, 'HTTP_')) {
                $name = strtolower(str_replace('_', '-', substr($key, 5)));
                $headers[$name] = (string) $value;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }

        $body = [];
        if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            $raw = file_get_contents('php://input') ?: '';
            if ($raw !== '') {
                if (!str_contains($headers['content-type'] ?? '', 'application/json')) {
                    throw new HttpException(415, 'Request body must be JSON (Content-Type: application/json).');
                }
                $decoded = json_decode($raw, true);
                if (!is_array($decoded)) {
                    throw new HttpException(400, 'Malformed JSON body.');
                }
                $body = $decoded;
            }
        }

        return new self($method, $path, $_GET, $body, $headers);
    }

    public function withParams(array $params): self
    {
        $clone = clone $this;
        $clone->params = $params;
        return $clone;
    }

    public function param(string $name): string
    {
        return $this->params[$name] ?? '';
    }

    public function intParam(string $name): int
    {
        $value = $this->param($name);
        if (!ctype_digit($value)) {
            throw new HttpException(400, "Invalid route parameter '{$name}'.");
        }
        return (int) $value;
    }

    public function query(string $name, ?string $default = null): ?string
    {
        $value = $this->query[$name] ?? $default;
        return is_string($value) ? $value : $default;
    }

    public function body(): array
    {
        return $this->body;
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }
}

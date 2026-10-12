<?php
declare(strict_types=1);

namespace App\Core;

final class Response
{
    public function __construct(
        public readonly int $status,
        public readonly mixed $data = null
    ) {
    }

    public static function ok(mixed $data): self        { return new self(200, $data); }
    public static function created(mixed $data): self   { return new self(201, $data); }
    public static function accepted(mixed $data): self  { return new self(202, $data); }
    public static function noContent(): self            { return new self(204); }

    public function send(): void
    {
        http_response_code($this->status);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: no-referrer');
        header('Cache-Control: no-store');

        if ($this->status !== 204) {
            echo json_encode(
                $this->data,
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION
            );
        }
    }

    public static function error(int $status, string $message, array $errors = []): self
    {
        $payload = ['error' => $message];
        if ($errors !== []) {
            $payload['errors'] = $errors;
        }
        return new self($status, $payload);
    }
}

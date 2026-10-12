<?php
declare(strict_types=1);

namespace App\Core;

use App\Models\User;

final class Auth
{
    public function issueToken(array $user): array
    {
        $cfg  = config('jwt');
        $csrf = bin2hex(random_bytes(32));
        $now  = time();
        $token = self::encode([
            'sub'  => (int) $user['id'],
            'csrf' => $csrf,
            'iat'  => $now,
            'exp'  => $now + $cfg['ttl'],
        ], $cfg['secret']);

        return ['token' => $token, 'csrf_token' => $csrf, 'expires_in' => $cfg['ttl']];
    }

    // Writes must also echo the CSRF value stored inside the signed token
    public function requireUser(Request $request): void
    {
        $header = $request->header('authorization') ?? '';
        if (!preg_match('/^Bearer\s+(\S+)$/', $header, $m)) {
            throw new HttpException(401, 'Authentication required.');
        }

        $claims = self::decode($m[1], config('jwt')['secret']);
        if ($claims === null) {
            throw new HttpException(401, 'Invalid or expired token.');
        }

        if (in_array($request->method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            $sent = $request->header('x-csrf-token') ?? '';
            if (!is_string($claims['csrf'] ?? null) || !hash_equals($claims['csrf'], $sent)) {
                throw new HttpException(403, 'Missing or invalid CSRF token.');
            }
        }

        $user = User::find((int) ($claims['sub'] ?? 0));
        if ($user === null) {
            throw new HttpException(401, 'Account no longer exists.');
        }
        $request->user = ['sub' => $user['id'], 'name' => $user['name'], 'role' => $user['role']];
    }

    public function requireAdmin(Request $request): void
    {
        if ($request->user === null) {
            $this->requireUser($request);
        }
        if ($request->user['role'] !== 'admin') {
            throw new HttpException(403, 'Administrator access required.');
        }
    }

    private static function encode(array $claims, string $secret): string
    {
        $header  = self::b64(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $payload = self::b64(json_encode($claims));
        $sig     = self::b64(hash_hmac('sha256', "{$header}.{$payload}", $secret, true));
        return "{$header}.{$payload}.{$sig}";
    }

    private static function decode(string $token, string $secret): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }
        [$header, $payload, $sig] = $parts;

        // Only HS256, so "alg: none" tokens are rejected
        $headerData = json_decode(self::unb64($header), true);
        if (($headerData['alg'] ?? null) !== 'HS256') {
            return null;
        }

        $expected = self::b64(hash_hmac('sha256', "{$header}.{$payload}", $secret, true));
        if (!hash_equals($expected, $sig)) {
            return null;
        }

        $claims = json_decode(self::unb64($payload), true);
        if (!is_array($claims) || ($claims['exp'] ?? 0) < time()) {
            return null;
        }
        return $claims;
    }

    private static function b64(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function unb64(string $data): string
    {
        return (string) base64_decode(strtr($data, '-_', '+/'), true);
    }
}

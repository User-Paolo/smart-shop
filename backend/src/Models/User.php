<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Database;

final class User
{
    private const PUBLIC_COLUMNS = 'id, name, email, role, created_at';

    public static function findByEmail(string $email): ?array
    {
        $stmt = Database::connection()->prepare('SELECT * FROM users WHERE email = :email');
        $stmt->execute(['email' => $email]);
        return $stmt->fetch() ?: null;
    }

    public static function find(int $id): ?array
    {
        $stmt = Database::connection()->prepare('SELECT ' . self::PUBLIC_COLUMNS . ' FROM users WHERE id = :id');
        $stmt->execute(['id' => $id]);
        return $stmt->fetch() ?: null;
    }

    public static function all(): array
    {
        return Database::connection()
            ->query('SELECT ' . self::PUBLIC_COLUMNS . ' FROM users ORDER BY id')
            ->fetchAll();
    }

    public static function create(string $name, string $email, string $password, string $role = 'customer'): int
    {
        $stmt = Database::connection()->prepare(
            'INSERT INTO users (name, email, password_hash, role) VALUES (:name, :email, :hash, :role)'
        );
        $stmt->execute([
            'name'  => $name,
            'email' => $email,
            'hash'  => self::hash($password),
            'role'  => $role,
        ]);
        return (int) Database::connection()->lastInsertId();
    }

    public static function update(int $id, ?string $name, ?string $password): void
    {
        $sets   = [];
        $params = ['id' => $id];
        if ($name !== null) {
            $sets[] = 'name = :name';
            $params['name'] = $name;
        }
        if ($password !== null) {
            $sets[] = 'password_hash = :hash';
            $params['hash'] = self::hash($password);
        }
        if ($sets === []) {
            return;
        }
        Database::connection()
            ->prepare('UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = :id')
            ->execute($params);
    }

    public static function setRole(int $id, string $role): void
    {
        Database::connection()
            ->prepare('UPDATE users SET role = :role WHERE id = :id')
            ->execute(['role' => $role, 'id' => $id]);
    }

    public static function delete(int $id): bool
    {
        $stmt = Database::connection()->prepare('DELETE FROM users WHERE id = :id');
        $stmt->execute(['id' => $id]);
        return $stmt->rowCount() > 0;
    }

    public static function recentFailures(string $email, int $minutes): int
    {
        $stmt = Database::connection()->prepare(
            'SELECT COUNT(*) FROM login_attempts WHERE email = :email AND attempted_at > NOW() - INTERVAL :minutes MINUTE'
        );
        $stmt->bindValue('email', $email);
        $stmt->bindValue('minutes', $minutes, \PDO::PARAM_INT);
        $stmt->execute();
        return (int) $stmt->fetchColumn();
    }

    public static function recordFailure(string $email): void
    {
        Database::connection()->prepare('INSERT INTO login_attempts (email) VALUES (:email)')->execute(['email' => $email]);
    }

    public static function clearFailures(string $email): void
    {
        Database::connection()->prepare('DELETE FROM login_attempts WHERE email = :email')->execute(['email' => $email]);
    }

    public static function hash(string $password): string
    {
        $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
        return password_hash($password, $algo);
    }
}

<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Database;

final class Product
{
    private const SELECT = 'SELECT p.id, p.sku, p.name, p.description, p.price, p.stock, p.is_active,
                                   p.category_id, c.name AS category, p.created_at, p.updated_at
                            FROM products p
                            JOIN categories c ON c.id = p.category_id';

    private const SORTS = [
        'name'       => 'p.name ASC',
        'price_asc'  => 'p.price ASC',
        'price_desc' => 'p.price DESC',
        'newest'     => 'p.created_at DESC',
    ];

    public static function search(array $f, bool $includeInactive = false): array
    {
        $where  = [];
        $params = [];

        if (!$includeInactive) {
            $where[] = 'p.is_active = 1';
        }
        if (!empty($f['search'])) {
            $where[] = '(p.name LIKE :q1 OR p.description LIKE :q2 OR p.sku LIKE :q3)';
            $like = '%' . addcslashes($f['search'], '%_\\') . '%';
            $params['q1'] = $params['q2'] = $params['q3'] = $like;
        }
        if (!empty($f['category_id'])) {
            $where[] = 'p.category_id = :cat';
            $params['cat'] = (int) $f['category_id'];
        }
        if (isset($f['min_price'])) {
            $where[] = 'p.price >= :minp';
            $params['minp'] = (float) $f['min_price'];
        }
        if (isset($f['max_price'])) {
            $where[] = 'p.price <= :maxp';
            $params['maxp'] = (float) $f['max_price'];
        }
        if (!empty($f['in_stock'])) {
            $where[] = 'p.stock > 0';
        }

        $whereSql = $where ? ' WHERE ' . implode(' AND ', $where) : '';
        $order    = self::SORTS[$f['sort'] ?? 'name'] ?? self::SORTS['name'];
        $perPage  = max(1, min(100, (int) ($f['per_page'] ?? 12)));
        $page     = max(1, (int) ($f['page'] ?? 1));
        $offset   = ($page - 1) * $perPage;

        $pdo = Database::connection();

        $count = $pdo->prepare('SELECT COUNT(*) FROM products p' . $whereSql);
        $count->execute($params);
        $total = (int) $count->fetchColumn();

        $stmt = $pdo->prepare(self::SELECT . $whereSql . " ORDER BY {$order} LIMIT :limit OFFSET :offset");
        foreach ($params as $k => $v) {
            $stmt->bindValue($k, $v);
        }
        $stmt->bindValue('limit', $perPage, \PDO::PARAM_INT);
        $stmt->bindValue('offset', $offset, \PDO::PARAM_INT);
        $stmt->execute();

        return [
            'items' => array_map([self::class, 'cast'], $stmt->fetchAll()),
            'page'  => $page,
            'per_page' => $perPage,
            'total' => $total,
            'pages' => (int) ceil($total / $perPage),
        ];
    }

    public static function find(int $id): ?array
    {
        $stmt = Database::connection()->prepare(self::SELECT . ' WHERE p.id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ? self::cast($row) : null;
    }

    public static function skuExists(string $sku, ?int $exceptId = null): bool
    {
        $stmt = Database::connection()->prepare('SELECT id FROM products WHERE sku = :sku AND id <> :id');
        $stmt->execute(['sku' => $sku, 'id' => $exceptId ?? 0]);
        return (bool) $stmt->fetch();
    }

    public static function create(array $d): int
    {
        Database::connection()->prepare(
            'INSERT INTO products (category_id, sku, name, description, price, stock)
             VALUES (:category_id, :sku, :name, :description, :price, :stock)'
        )->execute([
            'category_id' => $d['category_id'],
            'sku'         => $d['sku'],
            'name'        => $d['name'],
            'description' => $d['description'],
            'price'       => $d['price'],
            'stock'       => $d['stock'],
        ]);
        return (int) Database::connection()->lastInsertId();
    }

    public static function update(int $id, array $fields): void
    {
        $allowed = ['category_id', 'sku', 'name', 'description', 'price', 'stock', 'is_active'];
        $sets    = [];
        $params  = ['id' => $id];
        foreach ($fields as $col => $value) {
            if (in_array($col, $allowed, true)) {
                $sets[] = "{$col} = :{$col}";
                $params[$col] = $value;
            }
        }
        if ($sets) {
            Database::connection()
                ->prepare('UPDATE products SET ' . implode(', ', $sets) . ' WHERE id = :id')
                ->execute($params);
        }
    }

    public static function adjustStock(int $id, int $delta): bool
    {
        $stmt = Database::connection()->prepare(
            'UPDATE products SET stock = stock + :delta WHERE id = :id AND stock + :delta2 >= 0'
        );
        $stmt->execute(['delta' => $delta, 'delta2' => $delta, 'id' => $id]);
        return $stmt->rowCount() > 0;
    }

    public static function categories(): array
    {
        $rows = Database::connection()->query('SELECT id, name FROM categories ORDER BY name')->fetchAll();
        return array_map(fn ($r) => ['id' => (int) $r['id'], 'name' => $r['name']], $rows);
    }

    public static function categoryExists(int $id): bool
    {
        $stmt = Database::connection()->prepare('SELECT 1 FROM categories WHERE id = :id');
        $stmt->execute(['id' => $id]);
        return (bool) $stmt->fetchColumn();
    }

    public static function cast(array $row): array
    {
        $row['id']          = (int) $row['id'];
        $row['category_id'] = (int) $row['category_id'];
        $row['price']       = (float) $row['price'];
        $row['stock']       = (int) $row['stock'];
        $row['is_active']   = (bool) $row['is_active'];
        return $row;
    }
}

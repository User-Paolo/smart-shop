<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Database;

final class Cart
{
    public static function forUser(int $userId): array
    {
        $stmt = Database::connection()->prepare(
            'SELECT ci.product_id, ci.quantity, p.name, p.sku, p.price, p.stock, p.is_active
             FROM cart_items ci
             JOIN products p ON p.id = ci.product_id
             WHERE ci.user_id = :uid
             ORDER BY ci.added_at'
        );
        $stmt->execute(['uid' => $userId]);

        $items = [];
        $total = 0.0;
        foreach ($stmt->fetchAll() as $r) {
            $line = round((float) $r['price'] * (int) $r['quantity'], 2);
            $total += $line;
            $items[] = [
                'product_id' => (int) $r['product_id'],
                'name'       => $r['name'],
                'sku'        => $r['sku'],
                'unit_price' => (float) $r['price'],
                'quantity'   => (int) $r['quantity'],
                'stock'      => (int) $r['stock'],
                'available'  => (bool) $r['is_active'] && (int) $r['stock'] >= (int) $r['quantity'],
                'line_total' => $line,
            ];
        }
        return ['items' => $items, 'total' => round($total, 2), 'count' => array_sum(array_column($items, 'quantity'))];
    }

    public static function quantityOf(int $userId, int $productId): int
    {
        $stmt = Database::connection()->prepare(
            'SELECT quantity FROM cart_items WHERE user_id = :uid AND product_id = :pid'
        );
        $stmt->execute(['uid' => $userId, 'pid' => $productId]);
        return (int) ($stmt->fetchColumn() ?: 0);
    }

    public static function set(int $userId, int $productId, int $quantity): void
    {
        Database::connection()->prepare(
            'INSERT INTO cart_items (user_id, product_id, quantity) VALUES (:uid, :pid, :qty)
             ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)'
        )->execute(['uid' => $userId, 'pid' => $productId, 'qty' => $quantity]);
    }

    public static function remove(int $userId, int $productId): bool
    {
        $stmt = Database::connection()->prepare(
            'DELETE FROM cart_items WHERE user_id = :uid AND product_id = :pid'
        );
        $stmt->execute(['uid' => $userId, 'pid' => $productId]);
        return $stmt->rowCount() > 0;
    }
}

<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Database;
use App\Core\HttpException;
use PDO;

final class Order
{
    public const TRANSITIONS = [
        'pending'   => ['shipped', 'cancelled'],
        'shipped'   => ['delivered'],
        'delivered' => [],
        'cancelled' => [],
    ];

    // One transaction: lock the rows, check stock, create the order, deduct stock, empty the cart
    public static function checkout(int $userId): int
    {
        return Database::transaction(function (PDO $pdo) use ($userId): int {
            $stmt = $pdo->prepare(
                'SELECT ci.product_id, ci.quantity, p.name, p.price, p.stock, p.is_active
                 FROM cart_items ci
                 JOIN products p ON p.id = ci.product_id
                 WHERE ci.user_id = :uid
                 ORDER BY ci.product_id
                 FOR UPDATE'
            );
            $stmt->execute(['uid' => $userId]);
            $lines = $stmt->fetchAll();

            if ($lines === []) {
                throw new HttpException(422, 'Your cart is empty.');
            }

            $problems = [];
            foreach ($lines as $l) {
                if (!$l['is_active']) {
                    $problems[(string) $l['product_id']] = "{$l['name']} is no longer available.";
                } elseif ((int) $l['stock'] < (int) $l['quantity']) {
                    $problems[(string) $l['product_id']] = "Only {$l['stock']} of {$l['name']} left in stock.";
                }
            }
            if ($problems) {
                throw new HttpException(409, 'Some items cannot be fulfilled.', $problems);
            }

            $pdo->prepare('INSERT INTO orders (user_id) VALUES (:uid)')->execute(['uid' => $userId]);
            $orderId = (int) $pdo->lastInsertId();

            $insertLine = $pdo->prepare(
                'INSERT INTO order_items (order_id, product_id, quantity, unit_price)
                 VALUES (:oid, :pid, :qty, :price)'
            );
            $deduct = $pdo->prepare(
                'UPDATE products SET stock = stock - :qty WHERE id = :pid AND stock >= :qty2'
            );

            foreach ($lines as $l) {
                $insertLine->execute([
                    'oid'   => $orderId,
                    'pid'   => $l['product_id'],
                    'qty'   => $l['quantity'],
                    'price' => $l['price'],
                ]);
                $deduct->execute(['qty' => $l['quantity'], 'qty2' => $l['quantity'], 'pid' => $l['product_id']]);
                if ($deduct->rowCount() !== 1) {
                    throw new HttpException(409, "Stock changed for {$l['name']}, please retry.");
                }
            }

            $pdo->prepare('DELETE FROM cart_items WHERE user_id = :uid')->execute(['uid' => $userId]);

            return $orderId;
        });
    }

    public static function list(?int $userId = null, ?string $status = null, int $page = 1, int $perPage = 50): array
    {
        $where  = [];
        $params = [];
        if ($userId !== null) {
            $where[] = 'o.user_id = :uid';
            $params['uid'] = $userId;
        }
        if ($status !== null) {
            $where[] = 'o.status = :status';
            $params['status'] = $status;
        }
        $whereSql = $where ? ' WHERE ' . implode(' AND ', $where) : '';
        $count = Database::connection()->prepare('SELECT COUNT(*) FROM orders o' . $whereSql);
        $count->execute($params);
        $total = (int) $count->fetchColumn();
        $page  = max(1, $page);

        $sql = 'SELECT o.id, o.user_id, u.name AS customer, u.email, o.status, o.created_at, o.updated_at,
                       COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS total,
                       COALESCE(SUM(oi.quantity), 0) AS item_count
                FROM orders o
                JOIN users u ON u.id = o.user_id
                LEFT JOIN order_items oi ON oi.order_id = o.id'
             . $whereSql
             . ' GROUP BY o.id, o.user_id, u.name, u.email, o.status, o.created_at, o.updated_at
                 ORDER BY o.created_at DESC, o.id DESC
                 LIMIT :limit OFFSET :offset';

        $stmt = Database::connection()->prepare($sql);
        foreach ($params as $k => $v) {
            $stmt->bindValue($k, $v);
        }
        $stmt->bindValue('limit', $perPage, \PDO::PARAM_INT);
        $stmt->bindValue('offset', ($page - 1) * $perPage, \PDO::PARAM_INT);
        $stmt->execute();
        return [
            'orders' => array_map([self::class, 'castHeader'], $stmt->fetchAll()),
            'page'   => $page,
            'pages'  => max(1, (int) ceil($total / $perPage)),
            'total'  => $total,
        ];
    }

    public static function find(int $id): ?array
    {
        $stmt = Database::connection()->prepare(
            'SELECT o.id, o.user_id, u.name AS customer, u.email, o.status, o.created_at, o.updated_at
             FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = :id'
        );
        $stmt->execute(['id' => $id]);
        $order = $stmt->fetch();
        if (!$order) {
            return null;
        }

        $items = Database::connection()->prepare(
            'SELECT oi.product_id, p.name, p.sku, oi.quantity, oi.unit_price,
                    oi.quantity * oi.unit_price AS line_total
             FROM order_items oi JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id = :id ORDER BY p.name'
        );
        $items->execute(['id' => $id]);

        $order['items'] = array_map(fn ($i) => [
            'product_id' => (int) $i['product_id'],
            'name'       => $i['name'],
            'sku'        => $i['sku'],
            'quantity'   => (int) $i['quantity'],
            'unit_price' => (float) $i['unit_price'],
            'line_total' => round((float) $i['line_total'], 2),
        ], $items->fetchAll());
        $order['total']   = round(array_sum(array_column($order['items'], 'line_total')), 2);
        $order['id']      = (int) $order['id'];
        $order['user_id'] = (int) $order['user_id'];
        return $order;
    }

    public static function changeStatus(int $id, string $newStatus): void
    {
        Database::transaction(function (PDO $pdo) use ($id, $newStatus): void {
            $stmt = $pdo->prepare('SELECT status FROM orders WHERE id = :id FOR UPDATE');
            $stmt->execute(['id' => $id]);
            $current = $stmt->fetchColumn();
            if ($current === false) {
                throw new HttpException(404, 'Order not found.');
            }
            if (!in_array($newStatus, self::TRANSITIONS[$current], true)) {
                throw new HttpException(409, "Cannot change an order from '{$current}' to '{$newStatus}'.");
            }

            if ($newStatus === 'cancelled') {
                $pdo->prepare(
                    'UPDATE products p
                     JOIN order_items oi ON oi.product_id = p.id
                     SET p.stock = p.stock + oi.quantity
                     WHERE oi.order_id = :id'
                )->execute(['id' => $id]);
            }

            $pdo->prepare('UPDATE orders SET status = :s WHERE id = :id')
                ->execute(['s' => $newStatus, 'id' => $id]);
        });
    }

    private static function castHeader(array $r): array
    {
        $r['id']         = (int) $r['id'];
        $r['user_id']    = (int) $r['user_id'];
        $r['total']      = round((float) $r['total'], 2);
        $r['item_count'] = (int) $r['item_count'];
        return $r;
    }
}

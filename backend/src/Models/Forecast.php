<?php
declare(strict_types=1);

namespace App\Models;

use App\Core\Database;

final class Forecast
{
    public static function summary(): array
    {
        $risk = config('risk');
        $pdo  = Database::connection();

        $latest = $pdo->query('SELECT MAX(generated_at) FROM inventory_forecasts')->fetchColumn();
        if (!$latest) {
            return ['generated_at' => null, 'model' => null, 'products' => []];
        }

        $stmt = $pdo->prepare(
            'SELECT p.id, p.sku, p.name, p.stock, c.name AS category,
                    SUM(f.predicted_quantity)  AS predicted_7d,
                    MAX(f.model_name)          AS model_name
             FROM inventory_forecasts f
             JOIN products p   ON p.id = f.product_id
             JOIN categories c ON c.id = p.category_id
             WHERE f.generated_at = :latest AND p.is_active = 1
             GROUP BY p.id, p.sku, p.name, p.stock, c.name'
        );
        $stmt->execute(['latest' => $latest]);

        $daily = $pdo->prepare(
            'SELECT product_id, forecast_date, predicted_quantity
             FROM inventory_forecasts WHERE generated_at = :latest ORDER BY forecast_date'
        );
        $daily->execute(['latest' => $latest]);
        $series = [];
        foreach ($daily->fetchAll() as $d) {
            $series[(int) $d['product_id']][] = [
                'date'      => $d['forecast_date'],
                'predicted' => round((float) $d['predicted_quantity'], 2),
            ];
        }

        $products = [];
        $model    = null;
        foreach ($stmt->fetchAll() as $r) {
            $predicted = round((float) $r['predicted_7d'], 2);
            $stock     = (int) $r['stock'];
            $ratio     = $stock > 0 ? $predicted / $stock : ($predicted > 0 ? INF : 0);
            $level     = $ratio >= $risk['high_ratio'] ? 'high'
                       : ($ratio >= $risk['medium_ratio'] ? 'medium' : 'low');
            $model   ??= $r['model_name'];

            $products[] = [
                'product_id'        => (int) $r['id'],
                'sku'               => $r['sku'],
                'name'              => $r['name'],
                'category'          => $r['category'],
                'stock'             => $stock,
                'predicted_7d'      => $predicted,
                'coverage_days'     => $predicted > 0 ? round($stock / ($predicted / 7), 1) : null,
                'risk'              => $level,
                // Enough stock for two weeks of predicted demand
                'suggested_restock' => max(0, (int) ceil($predicted * 2 - $stock)),
                'model'             => $r['model_name'],
                'daily'             => $series[(int) $r['id']] ?? [],
            ];
        }

        $order = ['high' => 0, 'medium' => 1, 'low' => 2];
        usort($products, fn ($a, $b) =>
            [$order[$a['risk']], $a['coverage_days'] ?? PHP_INT_MAX] <=> [$order[$b['risk']], $b['coverage_days'] ?? PHP_INT_MAX]);

        return ['generated_at' => $latest, 'model' => $model, 'products' => $products];
    }

    public static function salesHistory(int $productId, int $days = 30): array
    {
        $stmt = Database::connection()->prepare(
            'SELECT DATE(o.created_at) AS day, SUM(oi.quantity) AS units
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE oi.product_id = :pid
               AND o.status <> \'cancelled\'
               AND o.created_at >= CURDATE() - INTERVAL :days DAY
             GROUP BY DATE(o.created_at)
             ORDER BY day'
        );
        $stmt->bindValue('pid', $productId, \PDO::PARAM_INT);
        $stmt->bindValue('days', $days, \PDO::PARAM_INT);
        $stmt->execute();
        return array_map(fn ($r) => ['date' => $r['day'], 'units' => (int) $r['units']], $stmt->fetchAll());
    }
}

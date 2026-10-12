<?php
declare(strict_types=1);


use App\Core\Database;
use App\Models\User;

require __DIR__ . '/../src/bootstrap.php';

$pdo = Database::connection();

if (in_array('--if-empty', $argv, true) && (int) $pdo->query('SELECT COUNT(*) FROM products')->fetchColumn() > 0) {
    echo "Demo data already present, skipping.\n";
    exit(0);
}
mt_srand(42); // same demo data on every run

echo "Resetting tables...\n";
foreach (['login_attempts', 'inventory_forecasts', 'cart_items', 'order_items', 'orders', 'products', 'categories', 'users'] as $t) {
    $pdo->exec("DELETE FROM {$t}");
}

echo "Creating users...\n";
User::create('Store Admin', 'admin@smartshop.test', 'Admin1234', 'admin');
$customerIds = [];
$names = ['Maria Papadopoulou', 'Nikos Georgiou', 'Eleni Dimitriou', 'Giorgos Ioannou',
          'Sofia Nikolaou', 'Kostas Christou', 'Anna Vasileiou', 'Dimitris Pappas'];
foreach ($names as $i => $name) {
    $email = 'customer' . ($i + 1) . '@smartshop.test';
    $customerIds[] = User::create($name, $email, 'Customer123');
}

echo "Creating catalogue...\n";
$categories = ['Electronics', 'Home & Kitchen', 'Sports', 'Books', 'Office'];
$catIds = [];
$insCat = $pdo->prepare('INSERT INTO categories (name) VALUES (:n)');
foreach ($categories as $c) {
    $insCat->execute(['n' => $c]);
    $catIds[$c] = (int) $pdo->lastInsertId();
}

// [category, sku, name, description, price, stock, base daily demand, daily trend]
$products = [
    ['Electronics',    'EL-1001', 'Wireless Earbuds',          'Bluetooth 5.3 earbuds with charging case and 24h battery.', 49.90,  60, 3.0,  0.040],
    ['Electronics',    'EL-1002', 'USB-C Fast Charger 65W',    'GaN charger for laptops, tablets and phones.',               34.50,  25, 2.2,  0.030],
    ['Electronics',    'EL-1003', 'Mechanical Keyboard',       'Hot-swappable switches, RGB backlight, aluminium frame.',   89.00,  40, 1.2,  0.000],
    ['Electronics',    'EL-1004', '27" IPS Monitor',           '1440p, 144Hz, height-adjustable stand.',                    249.00, 18, 0.5,  0.006],
    ['Home & Kitchen', 'HK-2001', 'Ceramic Coffee Mug Set',    'Set of 4 stoneware mugs, dishwasher safe.',                  24.90, 80, 2.5, -0.010],
    ['Home & Kitchen', 'HK-2002', 'Stainless Steel Kettle',    '1.7L electric kettle with auto shut-off.',                   39.90, 12, 1.4,  0.020],
    ['Home & Kitchen', 'HK-2003', 'Non-stick Frying Pan 28cm', 'PFOA-free coating, induction compatible.',                   29.90, 55, 1.6,  0.000],
    ['Sports',         'SP-3001', 'Yoga Mat Pro',              '6mm non-slip mat with carrying strap.',                      27.50, 30, 2.0,  0.035],
    ['Sports',         'SP-3002', 'Adjustable Dumbbells 20kg', 'Pair of quick-adjust dumbbells.',                           119.00, 10, 0.6,  0.010],
    ['Sports',         'SP-3003', 'Insulated Water Bottle',    '750ml, keeps drinks cold for 24 hours.',                     19.90, 90, 3.5,  0.025],
    ['Books',          'BK-4001', 'Clean Code',                'A handbook of agile software craftsmanship.',                38.00, 35, 0.9,  0.000],
    ['Books',          'BK-4002', 'The Pragmatic Programmer',  '20th anniversary edition.',                                   42.00, 22, 0.8,  0.005],
    ['Office',         'OF-5001', 'Ergonomic Office Chair',    'Lumbar support, adjustable armrests, mesh back.',           189.00,  8, 0.4,  0.004],
    ['Office',         'OF-5002', 'A5 Dotted Notebook 3-pack', '120gsm paper, lay-flat binding.',                            14.90, 140, 2.8, -0.005],
    ['Office',         'OF-5003', 'LED Desk Lamp',             'Dimmable, 5 colour temperatures, USB port.',                 32.00, 45, 1.1,  0.000],
];

$insProd = $pdo->prepare(
    'INSERT INTO products (category_id, sku, name, description, price, stock)
     VALUES (:cat, :sku, :name, :descr, :price, :stock)'
);
$productRows = [];
foreach ($products as [$cat, $sku, $name, $descr, $price, $stock, $base, $trend]) {
    $insProd->execute([
        'cat' => $catIds[$cat], 'sku' => $sku, 'name' => $name,
        'descr' => $descr, 'price' => $price, 'stock' => $stock,
    ]);
    $productRows[] = ['id' => (int) $pdo->lastInsertId(), 'price' => $price, 'base' => $base, 'trend' => $trend];
}

echo "Generating 90 days of orders...\n";
$insOrder = $pdo->prepare('INSERT INTO orders (user_id, status, created_at, updated_at) VALUES (:u, :s, :t, :t2)');
$insItem  = $pdo->prepare('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (:o, :p, :q, :pr)');

$poisson = static function (float $lambda): int {
    if ($lambda <= 0) return 0;
    $l = exp(-$lambda); $k = 0; $p = 1.0;
    do { $k++; $p *= mt_rand() / mt_getrandmax(); } while ($p > $l);
    return $k - 1;
};

$orderCount = 0;
$pdo->beginTransaction();
for ($daysAgo = 90; $daysAgo >= 1; $daysAgo--) {
    $date      = new DateTimeImmutable("-{$daysAgo} days");
    $dayIndex  = 90 - $daysAgo;
    $isWeekend = (int) $date->format('N') >= 6;

    $basket = [];
    foreach ($productRows as $p) {
        $lambda = max(0.05, $p['base'] + $p['trend'] * $dayIndex) * ($isWeekend ? 1.3 : 1.0);
        $units  = $poisson($lambda);
        if ($units > 0) {
            $basket[] = [$p, $units];
        }
    }

    shuffle($basket);
    while ($basket) {
        $lines = array_splice($basket, 0, mt_rand(1, 3));
        $time  = $date->setTime(mt_rand(8, 22), mt_rand(0, 59))->format('Y-m-d H:i:s');
        $status = $daysAgo > 7 ? 'delivered' : ($daysAgo > 2 ? 'shipped' : 'pending');

        $insOrder->execute([
            'u' => $customerIds[array_rand($customerIds)], 's' => $status, 't' => $time, 't2' => $time,
        ]);
        $orderId = (int) $pdo->lastInsertId();
        foreach ($lines as [$p, $units]) {
            $insItem->execute(['o' => $orderId, 'p' => $p['id'], 'q' => $units, 'pr' => $p['price']]);
        }
        $orderCount++;
    }
}
$pdo->commit();

echo "Done: " . count($productRows) . " products, " . (count($customerIds) + 1) . " users, {$orderCount} orders.\n\n";
echo "Admin login:     admin@smartshop.test / Admin1234\n";
echo "Customer login:  customer1@smartshop.test / Customer123\n";

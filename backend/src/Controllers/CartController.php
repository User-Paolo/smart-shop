<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Validator;
use App\Models\Cart;
use App\Models\Product;

final class CartController
{
    public function show(Request $req): Response
    {
        return Response::ok(Cart::forUser((int) $req->user['sub']));
    }

    public function add(Request $req): Response
    {
        $uid = (int) $req->user['sub'];
        $v   = new Validator($req->body());
        $pid = $v->int('product_id', 1);
        $qty = $v->int('quantity', 1, 99);
        $v->validate();

        $product = $this->activeProduct($pid);
        $newQty  = Cart::quantityOf($uid, $pid) + $qty;
        $this->assertStock($product, $newQty);

        Cart::set($uid, $pid, $newQty);
        return Response::ok(Cart::forUser($uid));
    }

    public function update(Request $req): Response
    {
        $uid = (int) $req->user['sub'];
        $pid = $req->intParam('productId');
        $v   = new Validator($req->body());
        $qty = $v->int('quantity', 1, 99);
        $v->validate();

        if (Cart::quantityOf($uid, $pid) === 0) {
            throw new HttpException(404, 'This product is not in your cart.');
        }
        $this->assertStock($this->activeProduct($pid), $qty);

        Cart::set($uid, $pid, $qty);
        return Response::ok(Cart::forUser($uid));
    }

    public function remove(Request $req): Response
    {
        $uid = (int) $req->user['sub'];
        if (!Cart::remove($uid, $req->intParam('productId'))) {
            throw new HttpException(404, 'This product is not in your cart.');
        }
        return Response::ok(Cart::forUser($uid));
    }

    private function activeProduct(int $id): array
    {
        $p = Product::find($id);
        if ($p === null || !$p['is_active']) {
            throw new HttpException(404, 'Product not found.');
        }
        return $p;
    }

    private function assertStock(array $product, int $qty): void
    {
        if ($qty > $product['stock']) {
            throw new HttpException(409, "Only {$product['stock']} of {$product['name']} in stock.");
        }
    }
}

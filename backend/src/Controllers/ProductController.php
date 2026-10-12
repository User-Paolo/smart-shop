<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Validator;
use App\Models\Product;

final class ProductController
{
    public function index(Request $req): Response
    {
        $filters = [
            'search'      => mb_substr(trim($req->query('search', '') ?? ''), 0, 100),
            'category_id' => ctype_digit($req->query('category_id', '') ?? '') ? (int) $req->query('category_id') : null,
            'min_price'   => is_numeric($req->query('min_price')) ? (float) $req->query('min_price') : null,
            'max_price'   => is_numeric($req->query('max_price')) ? (float) $req->query('max_price') : null,
            'in_stock'    => $req->query('in_stock') === '1',
            'sort'        => $req->query('sort', 'name'),
            'page'        => (int) ($req->query('page', '1') ?? 1),
            'per_page'    => (int) ($req->query('per_page', '12') ?? 12),
        ];
        $filters = array_filter($filters, fn ($v) => $v !== null);
        return Response::ok(Product::search($filters));
    }

    public function adminIndex(Request $req): Response
    {
        return Response::ok(Product::search([
            'search'   => mb_substr(trim($req->query('search', '') ?? ''), 0, 100),
            'per_page' => 100,
            'page'     => (int) ($req->query('page', '1') ?? 1),
        ], includeInactive: true));
    }

    public function show(Request $req): Response
    {
        $product = Product::find($req->intParam('id'));
        if ($product === null || !$product['is_active']) {
            throw new HttpException(404, 'Product not found.');
        }
        return Response::ok(['product' => $product]);
    }

    public function categories(Request $req): Response
    {
        return Response::ok(['categories' => Product::categories()]);
    }

    public function store(Request $req): Response
    {
        $data = $this->validated($req->body(), partial: false);
        if (Product::skuExists($data['sku'])) {
            throw new HttpException(409, 'A product with this SKU already exists.');
        }
        $id = Product::create($data);
        return Response::created(['product' => Product::find($id)]);
    }

    public function update(Request $req): Response
    {
        $id = $req->intParam('id');
        Product::find($id) ?? throw new HttpException(404, 'Product not found.');

        $data = $this->validated($req->body(), partial: $req->method === 'PATCH');
        if (isset($data['sku']) && Product::skuExists($data['sku'], $id)) {
            throw new HttpException(409, 'A product with this SKU already exists.');
        }
        Product::update($id, $data);
        return Response::ok(['product' => Product::find($id)]);
    }

    public function adjustStock(Request $req): Response
    {
        $id = $req->intParam('id');
        Product::find($id) ?? throw new HttpException(404, 'Product not found.');

        $v     = new Validator($req->body());
        $delta = $v->int('adjustment', -100000, 100000);
        $v->validate();
        if ($delta === 0) {
            throw new HttpException(422, 'Validation failed.', ['adjustment' => 'Must not be zero.']);
        }
        if (!Product::adjustStock($id, $delta)) {
            throw new HttpException(409, 'Stock cannot go below zero.');
        }
        return Response::ok(['product' => Product::find($id)]);
    }

    // Soft delete, so order history stays intact
    public function destroy(Request $req): Response
    {
        $id = $req->intParam('id');
        Product::find($id) ?? throw new HttpException(404, 'Product not found.');
        Product::update($id, ['is_active' => 0]);
        return Response::noContent();
    }

    private function validated(array $body, bool $partial): array
    {
        $v   = new Validator($body);
        $out = [];
        $req = !$partial;

        if ($req || $v->has('name'))        $out['name']        = $v->string('name', 2, 150);
        if ($req || $v->has('sku'))         $out['sku']         = $v->string('sku', 2, 40);
        if ($req || $v->has('description')) $out['description'] = $v->string('description', 0, 2000, required: false) ?? '';
        if ($req || $v->has('price'))       $out['price']       = $v->money('price');
        if ($req || $v->has('stock'))       $out['stock']       = $v->int('stock', 0, 1000000);
        if ($req || $v->has('category_id')) $out['category_id'] = $v->int('category_id', 1);
        if ($v->has('is_active')) {
            $active = $body['is_active'];
            if (!is_bool($active)) {
                throw new HttpException(422, 'Validation failed.', ['is_active' => 'Must be true or false.']);
            }
            $out['is_active'] = $active ? 1 : 0;
        }
        $v->validate();

        if (isset($out['sku']) && !preg_match('/^[A-Za-z0-9\-_]+$/', $out['sku'])) {
            throw new HttpException(422, 'Validation failed.', ['sku' => 'Letters, numbers, dashes and underscores only.']);
        }
        if (isset($out['category_id']) && !Product::categoryExists($out['category_id'])) {
            throw new HttpException(422, 'Validation failed.', ['category_id' => 'Unknown category.']);
        }
        return $out;
    }
}

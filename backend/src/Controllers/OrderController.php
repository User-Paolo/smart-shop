<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Validator;
use App\Models\Order;

final class OrderController
{
    public function checkout(Request $req): Response
    {
        $orderId = Order::checkout((int) $req->user['sub']);
        return Response::created(['order' => Order::find($orderId)]);
    }

    public function mine(Request $req): Response
    {
        return Response::ok(Order::list((int) $req->user['sub'], null, (int) ($req->query('page', '1') ?? 1)));
    }

    public function show(Request $req): Response
    {
        $order = Order::find($req->intParam('id'));
        $isOwner = $order !== null && $order['user_id'] === (int) $req->user['sub'];
        if ($order === null || (!$isOwner && $req->user['role'] !== 'admin')) {
            // 404, not 403, so other customers' order IDs are never confirmed
            throw new HttpException(404, 'Order not found.');
        }
        return Response::ok(['order' => $order]);
    }

    public function adminIndex(Request $req): Response
    {
        $status = $req->query('status');
        if ($status !== null && $status !== '' && !array_key_exists($status, Order::TRANSITIONS)) {
            throw new HttpException(422, 'Unknown status filter.');
        }
        return Response::ok(Order::list(null, $status ?: null, (int) ($req->query('page', '1') ?? 1)));
    }

    public function updateStatus(Request $req): Response
    {
        $id     = $req->intParam('id');
        $v      = new Validator($req->body());
        $status = $v->in('status', array_keys(Order::TRANSITIONS));
        $v->validate();

        Order::changeStatus($id, $status);
        return Response::ok(['order' => Order::find($id)]);
    }
}

<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Validator;
use App\Models\User;

final class UserController
{
    public function register(Request $req): Response
    {
        $v        = new Validator($req->body());
        $name     = $v->string('name', 2, 100);
        $email    = $v->email('email');
        $password = $v->password('password');
        $v->validate();
        if (User::findByEmail($email) !== null) {
            throw new HttpException(409, 'An account with this email already exists.');
        }

        $id   = User::create($name, $email, $password);
        $user = User::find($id);

        return Response::created(['user' => $user] + (new Auth())->issueToken($user));
    }

    public function login(Request $req): Response
    {
        $v        = new Validator($req->body());
        $email    = $v->email('email');
        $password = $v->string('password', 1, 128, trim: false);
        $v->validate();

        $limit = config('login');
        if (User::recentFailures($email, $limit['window_minutes']) >= $limit['max_failures']) {
            throw new HttpException(429, "Too many failed attempts. Try again in {$limit['window_minutes']} minutes.");
        }

        $row = User::findByEmail($email);
        // Same message either way, so the API cannot reveal which emails exist
        if ($row === null || !password_verify($password, $row['password_hash'])) {
            User::recordFailure($email);
            throw new HttpException(401, 'Invalid email or password.');
        }
        User::clearFailures($email);

        $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
        if (password_needs_rehash($row['password_hash'], $algo)) {
            User::update((int) $row['id'], null, $password);
        }

        $user = User::find((int) $row['id']);
        return Response::ok(['user' => $user] + (new Auth())->issueToken($user));
    }

    public function me(Request $req): Response
    {
        $user = User::find((int) $req->user['sub']);
        if ($user === null) {
            throw new HttpException(401, 'Account no longer exists.');
        }
        return Response::ok(['user' => $user]);
    }

    public function updateMe(Request $req): Response
    {
        $body = $req->body();
        $v    = new Validator($body);
        $name     = $v->has('name') ? $v->string('name', 2, 100) : null;
        $password = $v->has('password') ? $v->password('password') : null;
        $v->validate();

        User::update((int) $req->user['sub'], $name, $password);
        return Response::ok(['user' => User::find((int) $req->user['sub'])]);
    }

    public function index(Request $req): Response
    {
        return Response::ok(['users' => User::all()]);
    }

    public function show(Request $req): Response
    {
        $user = User::find($req->intParam('id')) ?? throw new HttpException(404, 'User not found.');
        return Response::ok(['user' => $user]);
    }

    public function setRole(Request $req): Response
    {
        $id = $req->intParam('id');
        if ($id === (int) $req->user['sub']) {
            throw new HttpException(409, 'You cannot change your own role.');
        }
        $v    = new Validator($req->body());
        $role = $v->in('role', ['customer', 'admin']);
        $v->validate();

        User::find($id) ?? throw new HttpException(404, 'User not found.');
        User::setRole($id, $role);
        return Response::ok(['user' => User::find($id)]);
    }

    public function destroy(Request $req): Response
    {
        $id = $req->intParam('id');
        if ($id === (int) $req->user['sub']) {
            throw new HttpException(409, 'You cannot delete your own account.');
        }
        if (!User::delete($id)) {
            throw new HttpException(404, 'User not found.');
        }
        return Response::noContent();
    }
}

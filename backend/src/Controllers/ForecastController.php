<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\HttpException;
use App\Core\Request;
use App\Core\Response;
use App\Core\Validator;
use App\Models\Forecast;
use App\Models\Product;

final class ForecastController
{
    public function index(Request $req): Response
    {
        return Response::ok(Forecast::summary() + ['job' => $this->jobStatus()]);
    }

    public function history(Request $req): Response
    {
        $pid = $req->intParam('productId');
        Product::find($pid) ?? throw new HttpException(404, 'Product not found.');
        return Response::ok(['product_id' => $pid, 'history' => Forecast::salesHistory($pid, 30)]);
    }

    public function status(Request $req): Response
    {
        return Response::ok(['job' => $this->jobStatus()]);
    }

    public function run(Request $req): Response
    {
        $cfg = config('analytics');
        $job = $this->jobStatus();

        // A run stuck for over 10 minutes counts as dead
        $busy = in_array($job['state'] ?? null, ['queued', 'running'], true);
        if ($busy && time() - strtotime($job['started_at'] ?? 'now') < 600) {
            throw new HttpException(409, 'A forecast run is already in progress.');
        }
        if (!is_file($cfg['script'])) {
            throw new HttpException(500, 'Forecast script not found on the server.');
        }

        @mkdir(dirname($cfg['log_file']), 0775, true);
        file_put_contents($cfg['status_file'], json_encode([
            'state'      => 'queued',
            'started_at' => date('c'),
            'message'    => 'Forecast job launched.',
        ]));

        $python = escapeshellarg($cfg['python']);
        $script = escapeshellarg($cfg['script']);
        $status = escapeshellarg($cfg['status_file']);
        $log    = escapeshellarg($cfg['log_file']);

        if (PHP_OS_FAMILY === 'Windows') {
            // start /B detaches the process so the request returns at once
            pclose(popen("start \"forecast\" /B {$python} {$script} --status-file {$status} >> {$log} 2>&1", 'r'));
        } else {
            exec("nohup {$python} {$script} --status-file {$status} >> {$log} 2>&1 &");
        }

        return Response::accepted([
            'message' => 'Forecast job started in the background. Poll /api/admin/forecasts/status for progress.',
            'job'     => $this->jobStatus(),
        ]);
    }

    public function restock(Request $req): Response
    {
        $pid = $req->intParam('productId');
        Product::find($pid) ?? throw new HttpException(404, 'Product not found.');

        $v   = new Validator($req->body());
        $qty = $v->int('quantity', 1, 100000);
        $v->validate();

        Product::adjustStock($pid, $qty);
        return Response::ok([
            'message' => "Restock of {$qty} units authorised.",
            'product' => Product::find($pid),
        ]);
    }

    private function jobStatus(): array
    {
        $file = config('analytics')['status_file'];
        if (!is_file($file)) {
            return ['state' => 'never_run'];
        }
        $data = json_decode((string) file_get_contents($file), true);
        return is_array($data) ? $data : ['state' => 'unknown'];
    }
}

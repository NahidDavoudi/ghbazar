<?php
namespace App\Modules\Search;

use App\Core\Cache\RedisConnector;
use App\Core\Env;
use Predis\Client;

/**
 * Cache با Redis (اختیاری) و fallback فایلی
 */
class SearchCache
{
    private ?Client $redis = null;
    private bool   $redisTried = false;
    private string $dir;
    private int    $ttl;

    public function __construct()
    {
        $this->ttl = (int) Env::get('SEARCH_CACHE_TTL', 300);
        $this->dir = dirname(__DIR__, 2) . '/storage/cache/search';
        if (!is_dir($this->dir)) {
            @mkdir($this->dir, 0775, true);
        }
    }

    private function redis(): ?Client
    {
        if ($this->redisTried) {
            return $this->redis;
        }
        $this->redisTried = true;
        try {
            $client = RedisConnector::getInstance();
            $client->ping();
            $this->redis = $client;
        } catch (\Throwable) {
            $this->redis = null;
        }
        return $this->redis;
    }

    public function get(string $key): ?array
    {
        if ($r = $this->redis()) {
            try {
                $raw = $r->get($key);
                if ($raw) {
                    $data = json_decode($raw, true);
                    if (is_array($data)) {
                        return $data;
                    }
                }
            } catch (\Throwable) {
                // silent
            }
        }

        $path = $this->path($key);
        if (!is_file($path) || filemtime($path) + $this->ttl < time()) {
            if (is_file($path)) {
                @unlink($path);
            }
            return null;
        }
        $raw = @file_get_contents($path);
        if ($raw === false) {
            return null;
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : null;
    }

    public function set(string $key, array $data): void
    {
        $payload = json_encode($data, JSON_UNESCAPED_UNICODE);
        if ($payload === false) {
            return;
        }

        if ($r = $this->redis()) {
            try {
                $r->setex($key, $this->ttl, $payload);
                return;
            } catch (\Throwable) {
                // fall through to file
            }
        }

        @file_put_contents($this->path($key), $payload, LOCK_EX);
    }

    public function forget(string $key): void
    {
        if ($r = $this->redis()) {
            try { $r->del([$key]); } catch (\Throwable) {}
        }
        $path = $this->path($key);
        if (is_file($path)) {
            @unlink($path);
        }
    }

    private function path(string $key): string
    {
        $safe = preg_replace('/[^a-zA-Z0-9:_\-]/', '', $key) ?: 'x';
        return $this->dir . '/' . $safe . '.json';
    }
}
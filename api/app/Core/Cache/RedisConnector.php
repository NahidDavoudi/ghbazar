<?php
namespace App\Core\Cache;

use Predis\Client;
use App\Core\Env;

class RedisConnector
{
    private static ?Client $instance = null;
    private static bool $failed = false;

    public static function getInstance(): Client
    {
        if (self::$failed) {
            throw new \RuntimeException('Redis در دسترس نیست.');
        }

        if (self::$instance === null) {
            $host = (string) Env::get('REDIS_HOST', '');
            $port = (string) Env::get('REDIS_PORT', '');

            // اگر host یا port تنظیم نشده، به‌جای ساختن کلاینت خراب، خطا بده
            if ($host === '' || $port === '') {
                self::$failed = true;
                throw new \RuntimeException('Redis پیکربندی نشده است (REDIS_HOST / REDIS_PORT).');
            }

            $password = Env::get('REDIS_PASSWORD', null);
            if (is_string($password) && $password !== '' && strtolower($password) !== 'null') {
                $params['password'] = $password;
            }

            try {
                self::$instance = new Client([
                    'scheme' => 'tcp',
                    'host'   => $host,
                    'port'   => (int) $port,
                    'password' => $params['password'] ?? null,
                ]);
            } catch (\Throwable $e) {
                self::$failed = true;
                throw new \RuntimeException('Redis پیکربندی نامعتبر: ' . $e->getMessage());
            }
        }

        return self::$instance;
    }

    public static function isConfigured(): bool
    {
        $host = (string) Env::get('REDIS_HOST', '');
        $port = (string) Env::get('REDIS_PORT', '');
        return $host !== '' && $port !== '';
    }
}
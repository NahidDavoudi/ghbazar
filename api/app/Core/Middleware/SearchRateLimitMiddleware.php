<?php
namespace App\Core\Middleware;

use App\Core\Env;
use App\Core\Http\MiddlewareInterface;
use App\Core\Http\Request;
use App\Core\Http\Response;
use App\Core\Logger;
use App\Core\Security\RateLimiter;

class SearchRateLimitMiddleware implements MiddlewareInterface
{
    public function handle(Request $request, callable $next): Response
    {
        $max    = (int) Env::get('SEARCH_RATE_LIMIT', 60);
        $window = (int) Env::get('SEARCH_RATE_WINDOW', 60);

        $key = 'search:rl:' . ($request->userId() ?? $request->ip());

        try {
            $limiter = new RateLimiter();
            if ($limiter->tooManyAttempts($key, $max, $window)) {
                return Response::tooManyRequests('تعداد جستجوها بیش از حد مجاز است. لطفاً کمی صبر کنید.');
            }
            $limiter->hit($key, $window);
        } catch (\Throwable $e) {
            // اگر Redis در دسترس نیست، جستجو را مسدود نکن
            Logger::warning('rate limiter unavailable, allowing search', ['error' => $e->getMessage()]);
        }

        return $next($request);
    }
}
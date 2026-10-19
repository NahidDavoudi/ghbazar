<?php
namespace App\Modules\Search;

use App\Core\Controller;
use App\Core\Http\Request;
use App\Core\Logger;

class SearchController extends Controller
{
    private SearchService $service;

    public function __construct()
    {
        $this->service = new SearchService();
    }

    // GET /api/v1/search?q=...&limit=20
    public function index(Request $request): void
    {
        try {
            $query = $request->query('q', '');
            $query = is_string($query) ? trim($query) : '';

            if ($query === '') {
                $this->success([
                    'query' => '',
                    'normalized_query' => '',
                    'tokens' => [],
                    'total' => 0,
                    'items' => [],
                ], 'پارامتر جستجو ارائه نشده است');
                return;
            }

            if (mb_strlen($query) > 128) {
                $this->error('عبارت جستجو بیش از حد طولانی است (حداکثر ۱۲۸ کاراکتر).', 422);
                return;
            }

            if (!mb_check_encoding($query, 'UTF-8')) {
                $this->error('کدگذاری متن جستجو نامعتبر است.', 400);
                return;
            }

            $limit = (int) $request->query('limit', 20);
            $result = $this->service->search($query, $limit);

            $this->success($result, 'نتایج جستجو');
        } catch (\Throwable $e) {
            Logger::error('search failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            $this->error('خطا در انجام جستجو', 500);
        }
    }
}
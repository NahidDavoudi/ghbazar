<?php
namespace App\Modules\Search;

use App\Core\Database\Database;
use PDO;

class SearchModel
{
    private PDO $pdo;
    private string $table = 'products';

    public function __construct()
    {
        $this->pdo = Database::getInstance()->getConnection();
    }

    /**
     * واکشی کاندیدها با LIKE روی نام compact‌شده (بدون فاصله/ZWNJ)
     * فیلتر اجباری: status='active' AND is_active=1
     *
     * نکته: REPLACE(name, ' ', '') روی ستون باعث full scan می‌شود؛
     * چون LIKE '%...%' هم index-پذیر نیست، هزینه‌ی اضافی نداریم.
     * برای production در حجم بالا، ستون name_normalized با FULLTEXT (ngram) توصیه می‌شود.
     */
    public function findCandidates(array $likeTerms, int $limit = 300): array
    {
        if (!$likeTerms) {
            return [];
        }

        $compactExpr = "REPLACE(REPLACE(p.name, ' ', ''), '\u{200C}', '')";
        $conditions  = [];
        $params      = [];

        foreach ($likeTerms as $i => $term) {
            // Escape % و _ و backslash برای LIKE
            $escaped = strtr($term, ['\\' => '\\\\', '%' => '\\%', '_' => '\\_']);
            $conditions[]   = "({$compactExpr} LIKE :name{$i} OR {$compactExpr} LIKE :desc{$i})";
            $params["name{$i}"] = '%' . $escaped . '%';
            $params["desc{$i}"] = '%' . $escaped . '%';
        }

        $sql = "
            SELECT
                p.id, p.name, p.slug, p.short_description, p.description,
                p.price, p.sale_price, p.stock, p.featured, p.views,
                p.category_id,
                c.name AS category_name,
                (SELECT COALESCE(NULLIF(pi.image_medium_url, ''), pi.image_url)
                 FROM product_images pi
                 WHERE pi.product_id = p.id AND pi.is_main = 1
                 LIMIT 1) AS main_image
            FROM {$this->table} p
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.status = 'active'
              AND p.is_active = 1
              AND (" . implode(' OR ', $conditions) . ")
            ORDER BY p.id DESC
            LIMIT " . (int) $limit;

        $stmt = $this->pdo->prepare($sql);
        foreach ($params as $k => $v) {
            $stmt->bindValue(':' . $k, $v, PDO::PARAM_STR);
        }
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * fallback محدود برای وقتی که LIKE هیچ نتیجه‌ای نداد (مثلاً کاربر تایپ اشتباه دارد)
     * به‌جای ۵۰۰۰ ردیف، فقط ۱۵۰ محصول فعال را برمی‌گردانیم
     */
    public function findFallbackCandidates(int $limit = 150): array
    {
        $sql = "
            SELECT
                p.id, p.name, p.slug, p.short_description, p.description,
                p.price, p.sale_price, p.stock, p.featured, p.views,
                p.category_id,
                c.name AS category_name,
                (SELECT COALESCE(NULLIF(pi.image_medium_url, ''), pi.image_url)
                 FROM product_images pi
                 WHERE pi.product_id = p.id AND pi.is_main = 1
                 LIMIT 1) AS main_image
            FROM {$this->table} p
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.status = 'active' AND p.is_active = 1
            ORDER BY p.views DESC, p.created_at DESC
            LIMIT " . (int) $limit;

        return $this->pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
    }
}
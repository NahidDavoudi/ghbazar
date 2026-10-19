<?php
namespace App\Modules\Search;

use App\Core\Logger;

class SearchService
{
    private const MAX_CANDIDATES = 300;
    private const MIN_SCORE      = 40.0;
    private const MIN_SIMILARITY = 0.55;
    private const DEFAULT_LIMIT  = 20;
    private const MAX_LIMIT      = 50;

    private SearchModel     $model;
    private QueryNormalizer $normalizer;
    private SearchCache     $cache;

    public function __construct()
    {
        $this->model      = new SearchModel();
        $this->normalizer = new QueryNormalizer();
        $this->cache      = new SearchCache();
    }

    public function search(string $query, int $limit = self::DEFAULT_LIMIT): array
    {
        $start = microtime(true);
        $query = trim($query);
        $limit = max(1, min(self::MAX_LIMIT, $limit));

        $normalized = $this->normalizer->normalize($query);
        $tokens     = $this->normalizer->tokenize($query);

        if ($normalized === '' || !$tokens) {
            return $this->emptyResult($query, $start);
        }

        $cacheKey = $this->normalizer->cacheKey($query, ['limit' => $limit]);
        if ($cached = $this->cache->get($cacheKey)) {
            $cached['took_ms'] = round((microtime(true) - $start) * 1000, 2);
            $cached['cached']  = true;
            return $cached;
        }

        $likeTerms  = $this->buildLikeTerms($tokens);
        $candidates = $this->model->findCandidates($likeTerms, self::MAX_CANDIDATES);

        if (!$candidates) {
            $candidates = $this->model->findFallbackCandidates(150);
        }

        $results = $this->scoreAndRank($normalized, $tokens, $candidates, $limit);

        $payload = [
            'query'            => $query,
            'normalized_query' => $normalized,
            'tokens'           => $tokens,
            'total'            => count($results),
            'items'            => $results,
            'cached'           => false,
            'took_ms'          => round((microtime(true) - $start) * 1000, 2),
        ];

        $this->cache->set($cacheKey, $payload);

        return $payload;
    }

    private function emptyResult(string $query, float $start): array
    {
        return [
            'query'            => $query,
            'normalized_query' => '',
            'tokens'           => [],
            'total'            => 0,
            'items'            => [],
            'cached'           => false,
            'took_ms'          => round((microtime(true) - $start) * 1000, 2),
        ];
    }

    /** برای هر توکن، نسخه‌ی compact‌شده + نسخه بدون آ را هم امتحان کن */
    private function buildLikeTerms(array $tokens): array
    {
        $out = [];
        foreach ($tokens as $t) {
            if (mb_strlen($t) < 2) {
                continue;
            }
            $compact = $this->normalizer->compact($t);
            $out[]   = $compact;
            if (str_contains($compact, 'آ')) {
                $out[] = str_replace('آ', 'ا', $compact);
            }
        }
        return array_values(array_unique(array_filter($out)));
    }

    private function scoreAndRank(string $normalizedQuery, array $queryTokens, array $candidates, int $limit): array
    {
        $scored = [];

        foreach ($candidates as $p) {
            $nameNorm = $this->normalizer->normalize((string) ($p['name'] ?? ''));
            if ($nameNorm === '') {
                continue;
            }
            $descNorm = $this->normalizer->normalize((string) ($p['short_description'] ?? ''));

            $nameScore = $this->scoreText($normalizedQuery, $queryTokens, $nameNorm);
            $descScore = $this->scoreText($normalizedQuery, $queryTokens, $descNorm);

            $total = ($nameScore['score'] * 0.8) + ($descScore['score'] * 0.2);

            if ($total < self::MIN_SCORE) {
                continue;
            }

            $scored[] = ['product' => $p, 'score' => round($total, 2), 'details' => [
                'name' => $nameScore,
                'desc' => $descScore,
            ]];
        }

        usort($scored, fn($a, $b) => $b['score'] <=> $a['score']);

        $out = [];
        foreach (array_slice($scored, 0, $limit) as $row) {
            $p = $row['product'];
            $price = (int) $p['price'];
            $sale  = $p['sale_price'] !== null ? (int) $p['sale_price'] : null;
            $final = ($sale !== null && $sale > 0 && $sale < $price) ? $sale : $price;

            $out[] = [
                'id'                => (int) $p['id'],
                'name'              => $p['name'],
                'slug'              => $p['slug'],
                'short_description' => $p['short_description'] ?? '',
                'price'             => $price,
                'sale_price'        => $sale,
                'final_price'       => $final,
                'main_image'        => $p['main_image'] ?? null,
                'category_id'       => $p['category_id'] !== null ? (int) $p['category_id'] : null,
                'category_name'     => $p['category_name'] ?? null,
                'stock'             => (int) $p['stock'],
                'in_stock'          => (int) $p['stock'] > 0,
                'is_featured'       => (bool) $p['featured'],
                'score'             => $row['score'],
            ];
        }

        return $out;
    }

    private function scoreText(string $normalizedQuery, array $queryTokens, string $text): array
    {
        $textTokens = $this->normalizer->tokenize($text);

        if (!$textTokens) {
            return ['score' => 0.0, 'similarity' => 0.0, 'coverage' => 0.0,
                    'phrase' => 0.0, 'sequence' => 0.0, 'compound' => 0.0, 'exact' => 0];
        }

        $sum         = 0.0;
        $matched     = 0;
        $exact       = 0;

        foreach ($queryTokens as $qt) {
            $threshold = mb_strlen($qt) <= 3 ? 0.45 : self::MIN_SIMILARITY;
            $best      = 0.0;
            $isExact   = false;

            foreach ($textTokens as $tt) {
                $s = $this->wordSimilarity($qt, $tt);
                if ($s > $best) {
                    $best = $s;
                }
                if ($qt === $tt) {
                    $isExact = true;
                    break;
                }
            }
            $sum += $best;
            if ($isExact) {
                $exact++;
            }
            if ($best >= $threshold) {
                $matched++;
            }
        }

        $tokenSimilarity = $sum / max(count($queryTokens), 1);
        $coverage        = $matched / max(count($queryTokens), 1);
        $phrase          = $this->wordSimilarity($normalizedQuery, $text);

        // sliding window برای ترتیب
        $seq = 0.0;
        $qN  = count($queryTokens);
        $tN  = count($textTokens);
        if ($qN > 0 && $tN >= $qN) {
            for ($i = 0; $i <= $tN - $qN; $i++) {
                $windowSum = 0.0;
                for ($j = 0; $j < $qN; $j++) {
                    $windowSum += $this->wordSimilarity($queryTokens[$j], $textTokens[$i + $j]);
                }
                $seq = max($seq, $windowSum / $qN);
            }
        }

        // compound: concatenation of adjacent text tokens
        $compound = 0.0;
        for ($i = 0; $i < $tN - 1; $i++) {
            $combined = $textTokens[$i] . $textTokens[$i + 1];
            foreach ($queryTokens as $qt) {
                if (mb_strlen($qt) < 4) {
                    continue;
                }
                $compound = max($compound, $this->wordSimilarity($qt, $combined));
            }
        }
        // reverse: query compact vs single text token (e.g. query "تی شرت" vs product "تیشرت")
        if ($qN > 1) {
            $qCompact = implode('', $queryTokens);
            foreach ($textTokens as $tt) {
                $compound = max($compound, $this->wordSimilarity($qCompact, $tt));
            }
        }

        $final = ($tokenSimilarity * 35) + ($coverage * 20) + ($phrase * 15)
               + ($seq * 15) + ($compound * 10) + ($exact * 5);

        return [
            'score'      => $final,
            'similarity' => round($tokenSimilarity, 3),
            'coverage'   => round($coverage, 3),
            'phrase'     => round($phrase, 3),
            'sequence'   => round($seq, 3),
            'compound'   => round($compound, 3),
            'exact'      => $exact,
        ];
    }

    private function wordSimilarity(string $a, string $b): float
    {
        if ($a === $b) {
            return 1.0;
        }
        $lenA = mb_strlen($a);
        $lenB = mb_strlen($b);
        if ($lenA === 0 || $lenB === 0) {
            return 0.0;
        }
        if (min($lenA, $lenB) >= 3 && (str_starts_with($a, $b) || str_starts_with($b, $a))) {
            return 0.92;
        }
        $max  = max($lenA, $lenB);
        $dist = $this->levenshteinUnicode($a, $b);
        return max(0.0, 1.0 - ($dist / $max));
    }

    /** Levenshtein درست برای UTF-8 (built-in فقط بایتی است) */
    private function levenshteinUnicode(string $a, string $b): int
    {
        $aChars = preg_split('//u', $a, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $bChars = preg_split('//u', $b, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $n = count($aChars);
        $m = count($bChars);
        if ($n === 0) return $m;
        if ($m === 0) return $n;

        $prev = range(0, $m);
        for ($i = 1; $i <= $n; $i++) {
            $curr = [$i];
            for ($j = 1; $j <= $m; $j++) {
                $cost = $aChars[$i - 1] === $bChars[$j - 1] ? 0 : 1;
                $curr[$j] = min($prev[$j] + 1, $curr[$j - 1] + 1, $prev[$j - 1] + $cost);
            }
            $prev = $curr;
        }
        return $prev[$m];
    }
}
<?php
namespace App\Modules\Search;

/**
 * نرمال‌سازی متن فارسی برای جستجو
 * حل مشکلات: ي/ی، ك/ک، أ/إ/آ، ارقام فارسی/عربی، ZWNJ (نیم‌فاصله)
 */
class QueryNormalizer
{
    private const CHAR_MAP = [
        'ي' => 'ی',   // Arabic yeh → Persian yeh
        'ك' => 'ک',   // Arabic kaf → Persian kaf
        'ة' => 'ه',   // Teh marbuta → heh
        'أ' => 'ا',   // Alef with hamza above
        'إ' => 'ا',   // Alef with hamza below
        'ٱ' => 'ا',   // Alef wasla
        'ؤ' => 'و',   // Waw with hamza
        'ئ' => 'ی',   // Yeh with hamza
        'ى' => 'ی',   // Alef maksura
        '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
        '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
        '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4',
        '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
        "\u{00A0}" => ' ',  // Non-breaking space
        "\u{200C}" => ' ',  // ZWNJ (نیم‌فاصله) → فاصله
        "\u{200D}" => ' ',  // ZWJ
        "\u{200E}" => '',   // LRM (کنترل‌ها حذف)
        "\u{200F}" => '',
    ];

    public function normalize(string $text): string
    {
        $text = mb_strtolower(trim($text));
        $text = strtr($text, self::CHAR_MAP);
        // هر چیز غیر حرف/عدد → فاصله
        $text = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $text) ?? '';
        $text = preg_replace('/\s+/u', ' ', $text) ?? '';
        return trim($text);
    }

    public function tokenize(string $text): array
    {
        $normalized = $this->normalize($text);
        if ($normalized === '') {
            return [];
        }
        $parts = preg_split('/\s+/u', $normalized) ?: [];
        return array_values(array_filter($parts, fn($t) => $t !== ''));
    }

    /**
     * نسخه‌ی compact: برای LIKE روی ستونی که فاصله و ZWNJ دارد
     * "تی شرت" → "تیشرت"  |  "بی‌سیم" → "بیسیم"
     */
    public function compact(string $text): string
    {
        return str_replace([' ', "\u{200C}", "\u{200D}"], '', $text);
    }

    public function cacheKey(string $query, array $options = []): string
    {
        $payload = $this->normalize($query) . '|' . json_encode($options, JSON_UNESCAPED_UNICODE);
        return 'search:v1:' . sha1($payload);
    }
}
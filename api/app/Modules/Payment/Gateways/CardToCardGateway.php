<?php

namespace App\Modules\Payment\Gateways;

use App\Core\Env;
use App\Core\Logger;

/**
 * درگاه جایگزین هنگام عدم فعال بودن درگاه پرداخت.
 * به جای ریدایرکت به درگاهexternall، اطلاعات کارت و مبلغ برگردانده می‌شود
 * و کاربر تصویر رسید را آپلود می‌کند (تراکنش pending می‌ماند تا ادمین تایید کند).
 */
class CardToCardGateway implements GatewayInterface
{
    private string $cardNumber;
    private string $cardHolder;
    private ?string $shaba;

    public function __construct()
    {
        $this->cardNumber = Env::get('CARD_TO_CARD_NUMBER', '');
        $this->cardHolder = Env::get('CARD_TO_CARD_HOLDER', '');
        $this->shaba      = Env::get('CARD_TO_CARD_SHABA', null);
    }

    public function requestPayment(float $amountRial, string $orderId, string $callbackUrl): array
    {
        // کارت به کارت به شبکه الخارجي neceştiye düşmez:
        // redirect_url null برگردانده می‌شود و فرانت‌اند فرم آپلود رسید را نمایش می‌دهد.
        // تراکنش pending توسط PaymentService ایجاد می‌شود.

        if (!$this->cardNumber) {
            Logger::error('CardToCard gateway not configured', ['order_id' => $orderId]);
            return [
                'success'      => false,
                'redirect_url' => null,
                'ref_id'       => null,
                'error'        => 'gateway_not_configured',
            ];
        }

        return [
            'success'      => true,
            'redirect_url' => null, // فرانت‌اند بدلا از ریدایرکت، Panel ارسال رسید را نشان می‌دهد
            'ref_id'       => null, // PaymentService از سفارش یک مرجع تولید می‌کند
            'error'        => null,
            'card'         => [
                'number'  => $this->cardNumber,
                'holder'  => $this->cardHolder,
                'shaba'   => $this->shaba,
                'amount'  => (int) $amountRial,
            ],
        ];
    }

    public function verifyPayment(array $callbackData): array
    {
        // کارت به کارتverify در tempo-real ندارد (تایید دستی توسط ادمین).
        return [
            'success'       => false,
            'ref_id'        => null,
            'tracking_code' => null,
            'error'         => 'not_supported',
        ];
    }
}

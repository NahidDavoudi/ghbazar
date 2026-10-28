<?php

namespace App\Modules\Payment;

use App\Core\Controller;
use App\Core\Http\Request;
use App\Core\Logger;
use App\Core\Env;

class PaymentController extends Controller
{
    private PaymentService $service;

    public function __construct()
    {
        $this->service = new PaymentService();
    }

    /**
     * ایجاد لینک پرداخت یا شماizing تراکنش card_to_card.
     * بدنه پاسخ: redirect_url، receipt_required، card، amount ...
     */
    public function initiate(Request $request): void
    {
        if (!$this->validate($request->all(), [
            'order_id' => 'required|integer',
        ])) {
            return;
        }

        $orderId = (int) $request->input('order_id');
        $result = $this->service->initiate($orderId);

        if (!$result['success']) {
            $this->error($this->mapErrorMessage($result['error']), 400);
            return;
        }

        $this->success([
            'redirect_url'    => $result['redirect_url'] ?? null,
            'ref_id'          => $result['ref_id'] ?? null,
            'receipt_required' => !empty($result['receipt_required']),
            'card'            => $result['card'] ?? null,
            'amount'          => $result['amount'] ?? null,
        ], 'لینک پرداخت ایجاد شد');
    }

    /**
     * آپلود رسید تصویر توسط مشتری.
     * بدنه: order_id + receipt (file multipart)
     */
    public function uploadReceipt(Request $request): void
    {
        $user = $this->user();
        if (!$user) {
            $this->unauthorized('ورود به سایت الزامی است');
            return;
        }

        if (!$this->validate($request->all(), [
            'order_id' => 'required|integer',
            'receipt'  => 'required|file',
        ])) {
            return;
        }

        $orderId = (int) $request->input('order_id');
        $file = $request->file('receipt');

        if (!$file || !isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
            $this->error('فایل دریافت نشد', 400);
            return;
        }

        // مسیر ذخیره‌سازی (با ساختار پروژه خودتان تطبیق دهید)
        $baseDir = Env::get('RECEIPT_STORAGE_PATH', dirname(__DIR__, 3) . '/storage/receipts');
        $uploadDir = $baseDir . '/' . $orderId;
        if (!is_dir($uploadDir)) {
            @mkdir($uploadDir, 0775, true);
        }

        $fileName = uniqid('receipt_', true) . '_' . basename($file['name']);
        $destination = $uploadDir . '/' . $fileName;

        if (!move_uploaded_file($file['tmp_name'], $destination)) {
            Logger::error('Failed to move uploaded receipt', ['order_id' => $orderId]);
            $this->error('خطا در ذخیره فایل رسید', 500);
            return;
        }

        // آدرس عامرسانه برای دیدن فایل (Route یا symlink را در وب سرور تنظیم کنید)
        $baseUrl = rtrim(Env::get('RECEIPT_BASE_URL', '/receipts'), '/');
        $publicPath = "{$baseUrl}/{$orderId}/{$fileName}";

        $result = $this->service->uploadReceipt($orderId, $publicPath, $fileName);

        if (!$result['success']) {
            $this->error($this->mapErrorMessage($result['error'] ?? 'upload_failed'), 400);
            return;
        }

        $this->success(['receipt_url' => $publicPath], 'رسید با موفقیت آپلود شد و در انتظار تایید است');
    }

    /**
     * تایید رسید توسط ادمین.
     */
    public function approveReceipt(Request $request): void
    {
        if (!$this->isAdminUser()) {
            $this->forbidden('دسترسی فقط برای ادمین مجاز است');
            return;
        }

        if (!$this->validate($request->all(), [
            'transaction_id' => 'required|integer',
        ])) {
            return;
        }

        $txId = (int) $request->input('transaction_id');
        $trackingCode = $request->input('tracking_code');

        $result = $this->service->approveReceipt($txId, $trackingCode);

        if (!$result['success']) {
            $this->error($this->mapErrorMessage($result['error'] ?? 'transaction_not_found'), 400);
            return;
        }

        $this->success(['order_id' => $result['order_id']], 'رسید تایید شد و سفارشPaid 되었다');
    }

    /**
     * رد رسید توسط ادمین.
     */
    public function rejectReceipt(Request $request): void
    {
        if (!$this->isAdminUser()) {
            $this->forbidden('دسترسی فقط برای ادمین مجاز است');
            return;
        }

        if (!$this->validate($request->all(), [
            'transaction_id' => 'required|integer',
        ])) {
            return;
        }

        $txId = (int) $request->input('transaction_id');

        $result = $this->service->rejectReceipt($txId);

        if (!$result['success']) {
            $this->error($this->mapErrorMessage($result['error'] ?? 'transaction_not_found'), 400);
            return;
        }

        $this->success(['order_id' => $result['order_id']], 'رسید رد شد');
    }

    public function callback(Request $request): void
    {
        $params = [
            'trans_id' => $request->query('trans_id'),
            'id_get'   => $request->query('id_get'),
        ];

        $result = $this->service->handleCallback($params);
        $redirectBase = Env::get('BITPAY_REDIRECT_URL');
        $status = $result['success'] ? 'success' : 'failed';
        $orderId = $result['order_id'] ?? '';

        header("Location: {$redirectBase}?order_id={$orderId}&status={$status}");
        exit;
    }

    private function isAdminUser(): bool
    {
        $user = $this->user();
        if (!$user) {
            return false;
        }
        // با هویت‌شناسی پروژه خودتان تطبیق دهید (مثلاً $user->role === 'admin')
        return isset($user->role) && $user->role === 'admin';
    }

    private function mapErrorMessage(string $code): string
    {
        return match ($code) {
            'order_not_found'       => 'سفارش یافت نشد',
            'connection_failed'     => 'خطا در اتصال به درگاه پرداخت',
            'api_key_invalid'       => 'کلید API درگاه نامعتبر است',
            'invalid_amount'        => 'مبلغ پرداخت نامعتبر است',
            'gateway_not_configured'=> 'درگاه پرداخت تنظیم نشده است',
            'upload_failed'         => 'خطا در آپلود رسید',
            'transaction_not_found' => 'تراکنش یافت نشد',
            default                 => 'خطا در ایجاد تراکنش پرداخت',
        };
    }
}

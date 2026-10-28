<?php

namespace App\Modules\Payment;

use App\Modules\Payment\Gateways\BitPayGateway;
use App\Modules\Payment\Gateways\CardToCardGateway;
use App\Modules\Payment\Gateways\GatewayInterface;
use App\Modules\Order\OrderModel;
use App\Core\Logger;
use App\Core\Env;

class PaymentService
{
    private GatewayInterface $gateway;
    private PaymentTransactionModel $transactions;
    private OrderModel $orders;

    public function __construct()
    {
        $mode = Env::get('PAYMENT_GATEWAY', 'bitpay');
        $this->gateway = $mode === 'card_to_card'
            ? new CardToCardGateway()
            : new BitPayGateway();
        $this->transactions = new PaymentTransactionModel();
        $this->orders       = new OrderModel();
    }

    /**
     * شروع پرداخت برای یک سفارش.
     * - bitpay: لینک درگاه برگردانده می‌شود.
     * - card_to_card: redirect_url null است و اطلاعات کارت + receipt_required=true برگردانده می‌شود.
     */
    public function initiate(int $orderId): array
    {
        $order = $this->orders->find($orderId);
        if (!$order) {
            return ['success' => false, 'error' => 'order_not_found'];
        }

        $amountRial = (float) $order['total_amount'] * 10;

        if ($this->gateway instanceof CardToCardGateway) {
            $result = $this->gateway->requestPayment($amountRial, (string) $orderId, '');
            if (!$result['success']) {
                return $result;
            }

            // trnx pending ایجاد شود تا رسید را به آن متصل کنیم
            $refId = (string) ($result['ref_id'] ?? $orderId);
            $txId = $this->transactions->createPending(
                $orderId,
                'card_to_card',
                $refId,
                (float) $order['total_amount']
            );

            $result['ref_id']             = (string) $txId;
            $result['receipt_required']   = true;
            $result['amount']             = (float) $order['total_amount'];
            return $result;
        }

        // مسیر قبلی: BitPay
        $callbackUrl = Env::get('BITPAY_CALLBACK_URL');
        $result = $this->gateway->requestPayment($amountRial, (string) $orderId, $callbackUrl);

        if (!$result['success']) {
            return $result;
        }

        $this->transactions->createPending($orderId, 'bitpay', $result['ref_id'], (float) $order['total_amount']);

        return $result;
    }

    /**
     * آپلود تصویر رسید توسط مشتری (مرحله card_to_card).
     */
    public function uploadReceipt(int $orderId, string $filePath, string $fileName): array
    {
        $order = $this->orders->find($orderId);
        if (!$order) {
            return ['success' => false, 'error' => 'order_not_found'];
        }

        $transaction = $this->transactions->findByOrderId($orderId);
        if (!$transaction) {
            $txId = $this->transactions->createPending(
                $orderId,
                'card_to_card',
                (string) $orderId,
                (float) $order['total_amount']
            );
            $transaction = $this->transactions->find($txId);
        }

        $this->transactions->setReceipt($transaction['id'], $filePath, $fileName);

        Logger::info('Receipt uploaded', [
            'order_id'   => $orderId,
            'transaction_id' => $transaction['id'],
            'file_name'  => $fileName,
        ]);

        return [
            'success'      => true,
            'transaction'  => $this->transactions->find($transaction['id']),
        ];
    }

    /**
     * تایید رسید توسط ادمین.
     */
    public function approveReceipt(int $transactionId, ?string $trackingCode = null): array
    {
        $transaction = $this->transactions->find($transactionId);
        if (!$transaction) {
            return ['success' => false, 'error' => 'transaction_not_found'];
        }

        $this->transactions->markStatus($transaction['id'], 'success', $trackingCode);
        $this->orders->update($transaction['order_id'], ['status' => 'paid']);

        Logger::info('Receipt approved', [
            'transaction_id' => $transactionId,
            'order_id'       => $transaction['order_id'],
            'tracking_code'  => $trackingCode,
        ]);

        return ['success' => true, 'order_id' => $transaction['order_id']];
    }

    /**
     * رد رسید توسط ادمین.
     */
    public function rejectReceipt(int $transactionId): array
    {
        $transaction = $this->transactions->find($transactionId);
        if (!$transaction) {
            return ['success' => false, 'error' => 'transaction_not_found'];
        }

        $this->transactions->markStatus($transaction['id'], 'failed');

        Logger::info('Receipt rejected', [
            'transaction_id' => $transactionId,
            'order_id'       => $transaction['order_id'],
        ]);

        return ['success' => true, 'order_id' => $transaction['order_id']];
    }

    public function handleCallback(array $callbackData): array
    {
        // لاگ کردن داده‌های دریافتی برای دیباگ
        Logger::info('BitPay callback received', $callbackData);

        $result = $this->gateway->verifyPayment($callbackData);

        // بررسی وجود id_get
        $idGet = $callbackData['id_get'] ?? null;
        if (!$idGet) {
            Logger::error('Missing id_get in callback', ['callback_data' => $callbackData]);
            return ['success' => false, 'order_id' => null, 'error' => 'missing_id_get'];
        }

        $transaction = $this->transactions->findByRefId((string) $idGet);

        if (!$transaction) {
            Logger::error('Transaction not found', ['ref_id' => $idGet]);
            return ['success' => false, 'order_id' => null, 'error' => 'transaction_not_found'];
        }

        if ($result['success']) {
            $this->transactions->markStatus($transaction['id'], 'success', $result['tracking_code'] ?? null);
            $this->orders->update($transaction['order_id'], ['status' => 'paid']);
        } else {
            $this->transactions->markStatus($transaction['id'], 'failed');
            Logger::error('Payment verification failed', [
                'order_id' => $transaction['order_id'],
                'result'   => $result,
            ]);
        }

        $result['order_id'] = $transaction['order_id'];
        return $result;
    }
}

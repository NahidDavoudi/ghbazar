<?php

namespace App\Modules\Payment;

use App\Core\Database\Model;

class PaymentTransactionModel extends Model
{
    protected string $table = 'payment_transactions';

    protected array $fillable = [
        'order_id',
        'gateway',
        'ref_id',
        'tracking_code',
        'receipt_path',
        'receipt_file_name',
        'amount',
        'status',
    ];

    public function createPending(int $orderId, string $gateway, string $refId, float $amount): int
    {
        return $this->create([
            'order_id'        => $orderId,
            'gateway'         => $gateway,
            'ref_id'          => $refId,
            'tracking_code'   => null,
            'receipt_path'    => null,
            'receipt_file_name' => null,
            'amount'          => $amount,
            'status'          => 'pending',
        ]);
    }

    public function findByRefId(string $refId): ?array
    {
        return $this->findBy('ref_id', $refId);
    }

    public function findByOrderId(int $orderId): ?array
    {
        return $this->findBy('order_id', $orderId);
    }

    public function markStatus(int $id, string $status, ?string $trackingCode = null): bool
    {
        return $this->update($id, [
            'status'        => $status,
            'tracking_code' => $trackingCode,
        ]);
    }

    public function setReceipt(int $id, string $path, string $fileName): bool
    {
        return $this->update($id, [
            'receipt_path'       => $path,
            'receipt_file_name'  => $fileName,
            'status'             => 'pending', // رسید Upload شده، هنوز تایید نشده
        ]);
    }
}

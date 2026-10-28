-- اضافه کردن ستون‌های رسید به جدول payment_transactions
ALTER TABLE payment_transactions
ADD COLUMN receipt_path VARCHAR(500) NULL AFTER tracking_code,
ADD COLUMN receipt_file_name VARCHAR(255) NULL AFTER receipt_path;

-- (اختیاری) اندیس برای جستجوی سریع تراکنش سفارش
-- CREATE INDEX idx_payment_transactions_order ON payment_transactions(order_id);
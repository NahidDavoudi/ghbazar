<?php
namespace App\Core\Database;

use App\Core\Env;
use \PDO;
use \PDOException;

class Database
{
    private static ?Database $instance = null;
    private PDO $pdo;

    public function __construct()
    {
        $host    = (string) Env::get('DB_HOST', 'localhost');
        $name    = (string) Env::get('DB_NAME', 'shop');
        $user    = (string) Env::get('DB_USER', 'root');
        $pass    = (string) Env::get('DB_PASS', '');
        $charset = (string) Env::get('DB_CHARSET', 'utf8mb4');

        $this->pdo = new PDO(
            "mysql:host={$host};dbname={$name};charset={$charset}",
            $user,
            $pass,
            [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]
        );
    }

    public static function getInstance(): self
    {
        if (!self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function getConnection(): PDO
    {
        return $this->pdo;
    }

    public function query(string $sql, array $params = []): \PDOStatement
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    public function lastInsertId(): int
    {
        return (int) $this->pdo->lastInsertId();
    }
}
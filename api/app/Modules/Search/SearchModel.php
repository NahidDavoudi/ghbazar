<?php
namespace App\Modules\Search;

// use App\Core\Database\Model;
use App\Core\Database\Database;
use PDO;

class SearchModel {
    protected PDO $pdo;
    protected $table = 'products';

    public function __construct()
    {
        $this->pdo = Database::getInstance()->getConnection();
    }
    public function search($query): array
    {
        $stmt = $this->pdo->prepare("SELECT id, name, description FROM {$this->table} WHERE name LIKE :name OR description LIKE :desc");
        $stmt->bindValue(':name', '%' . $query . '%');
        $stmt->bindValue(':desc' , '%' . $query . '%');
        $stmt->execute();
        $data = $this->paginate($stmt->fetchAll());
        return ;
    }
}
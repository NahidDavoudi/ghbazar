<?php
namespace App\Modules\Search;

use App\Core\Http\Request;
use App\Core\Controller;

class SearchController extends Controller{

    private SearchModel $model;

    public function __construct (){
        $this->model = new SearchModel();
    }
    public function index (Request $req){
        $q = $req->query('q');
        $q = is_string($q) ? trim('q') : '';
        if ($q = '') {
            $this->error('پارامتر جستجو ارائه نشده است', 400);
        }
        $escaped = str_replace(['\\' , '%' , '_' ] , ['\\\\' , '\%' , '\_'] , $q);
        return $this->json($this->model->search($escaped));

    }
}
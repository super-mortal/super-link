<?php

namespace Controllers;

use Config;
use Framework\ControllerInterface;
use Framework\Exceptions\DatabaseNotFound;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use PDO;
use function Framework\data;

class SetupDatabaseController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		try {
			// Check if database already exists
			$repository = ServiceContainer::get(Repository::class);
			$db_exists = $repository->checkDatabaseExists();

		} catch (DatabaseNotFound $e) {
			$db_exists = false;
		}

		if ($db_exists) {
			return data([
				'success' => false,
				'message' => 'Database already exists'
			], 400);
		}

		$db_path = Config::getDBPath();
		$pdo = new PDO("sqlite:{$db_path}");
		$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
		$repository = new Repository($pdo);

		// Create database tables
		$result = $repository->setupDatabase();

		if (!$result) {
			return data([
				'success' => false,
				'message' => 'Failed to set up database'
			], 500);
		}

		return data([
			'success' => true,
			'message' => 'Database setup completed successfully'
		], 200);
	}
}

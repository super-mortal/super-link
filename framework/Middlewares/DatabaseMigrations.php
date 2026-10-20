<?php

namespace Framework\Middlewares;

use Framework\Exceptions\DatabaseNotFound;
use Framework\ServiceContainer;
use Models\Repository;

class DatabaseMigrations extends MiddlewareAbstract
{
	public function handle()
	{
		// If the database is not set up yet, skip migration checks
		try {
			$repository = ServiceContainer::get(Repository::class);
		} catch (DatabaseNotFound $e) {
			return $this->next && $this->next->handle();
		}

		if (!$repository->checkDatabaseExists()) {
			return $this->next && $this->next->handle();
		}

		$repository->migrate();

		return $this->next && $this->next->handle();
	}
}
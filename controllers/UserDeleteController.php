<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\data;
use function Framework\getLoggedInUser;
use function Framework\logoutUser;

class UserDeleteController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		// Check if authentication is enabled (any user exists)
		$repository = ServiceContainer::get(Repository::class);
		$auth_enabled = $repository->userTableNotEmpty();

		if (!$auth_enabled) {
			return data([
				'success' => false,
				'message' => 'Authentication is disabled. Please set up a user account first.',
			], 400);
		}

		$user = getLoggedInUser();

		$result = $repository->deleteUser($user['id']);

		if (! $result) {
			return data([
				'success' => false,
				'message' => 'Failed to disable authentication.',
			], 500);
		}

		logoutUser();

		return data([
			'success' => true,
			'message' => 'Authentication disabled successfully.',
		], 200);
	}
}

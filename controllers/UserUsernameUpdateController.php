<?php

namespace Controllers;

use Exception;
use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\data;
use function Framework\getLoggedInUser;
use function Framework\validateUsername;

class UserUsernameUpdateController implements ControllerInterface
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

		try {
			$username = trim($input['username'] ?? '');
			validateUsername($username);
		} catch (Exception $e) {
			return data([
				'success' => false,
				'message' => $e->getMessage(),
			], 422);
		}

		// Update username
		$result = $repository->updateUsername($user['id'], $username);

		if (!$result) {
			return data([
				'success' => false,
				'message' => 'Failed to update username.',
			], 500);
		}

		return data([
			'success' => true,
			'message' => 'Username updated successfully.',
		], 200);
	}
}
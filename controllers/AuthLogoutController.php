<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\logoutUser;
use function Framework\success;

class AuthLogoutController  implements ControllerInterface
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

		logoutUser();

		return success('User logged out successfully.');
	}
}
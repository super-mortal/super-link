<?php

namespace Controllers;

use Config;
use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\data;
use function Framework\getLoggedInUser;
use function Framework\success;
use function Framework\validatePassword;
use function Framework\validatePasswordConfirmation;

class UserPasswordUpdateController implements ControllerInterface
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


		$password = $input['password'] ?? '';
		$confirm_password = $input['confirm_password'] ?? '';
		validatePassword($password);
		validatePasswordConfirmation($password, $confirm_password);

		$user = getLoggedInUser();
		$password_hash = password_hash($password, Config::getPasswordAlgo());
		$result = $repository->updatePasswordHash($user['id'], $password_hash);

		if (!$result) {
			throw new DataWriteException('Failed to update password.');
		}

		return success('Password updated successfully.');
	}
}
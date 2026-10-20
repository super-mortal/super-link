<?php

namespace Controllers;

use Config;
use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\data;
use function Framework\loginUser;
use function Framework\success;
use function Framework\validatePassword;
use function Framework\validatePasswordConfirmation;
use function Framework\validateUsername;
use function Utils\buildPublicUserObject;

class UserCreateController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		// Check if authentication is enabled (any user exists)
		$repository = ServiceContainer::get(Repository::class);
		$auth_enabled = $repository->userTableNotEmpty();

		// If auth is enabled already and user exists, raise an error
		if ($auth_enabled) {
			return data([
				'success' => false,
				'message' => 'User has been created already.'
			], 400);
		}

		$username = trim($input['username'] ?? '');
		validateUsername($username);

		$password = $input['password'] ?? '';
		$confirm_password = $input['confirm_password'] ?? '';
		validatePassword($password);
		validatePasswordConfirmation($password, $confirm_password);

		$password_hash = password_hash($password, Config::getPasswordAlgo());
		$user_id = $repository->createUser($username, $password_hash);

		if (!$user_id) {
			throw new DataWriteException('Failed to create user.');
		}

		loginUser($user_id);

		$user = $repository->getUser($user_id);

		return success('User created successfully.', [
			'user' => buildPublicUserObject($user)
		], 201);
	}
}

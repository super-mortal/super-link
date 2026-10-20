<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\UnauthorizedException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\data;
use function Framework\getLoggedInUser;
use function Framework\success;
use function Utils\buildPublicUserObject;

class UserGetController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		// Check if authentication is enabled (any user exists)
		$repository = ServiceContainer::get(Repository::class);
		$auth_enabled = $repository->userTableNotEmpty();

		if (!$auth_enabled) {
			return data([
				'message' => 'User has not been created.',
				'data' => [
					'user' => null,
				],
			], 200);
		}

		$user = getLoggedInUser();

		if (!$user) {
			throw new UnauthorizedException('No user is currently logged in.');
		}

		return success('User retrieved successfully.', [
			'user' => buildPublicUserObject($user)
		]);
	}
}

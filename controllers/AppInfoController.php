<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use RuntimeException;
use function Framework\success;
use function Utils\getAppUpdateInfo;
use function Utils\getInstalledAppInfo;

class AppInfoController implements ControllerInterface
{

	public function __invoke(array $input): ResponseInterface
	{
		$app_info = getInstalledAppInfo();
		$installed_version = $app_info['version'] ?? null;

		$update_info = getAppUpdateInfo();
		$latest_version = $update_info['latest_version'] ?? null;

		if ($installed_version === null && $latest_version === null) {
			throw new RuntimeException('Unable to fetch app version information.');
		}

		if ($installed_version !== null && $latest_version !== null) {
			$update_available = version_compare($latest_version, $installed_version, '>');
		} else {
			$update_available = null;
		}

		return success('App info retrieved', [
			'installed_version' => $installed_version,
			'latest_version' => $latest_version,
			'update_available' => $update_available,
		]);
	}
}
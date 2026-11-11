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

		// O-4：最新 release 的说明（Markdown）随版本信息一起下发，供前端在更新前展示。
		// GitHub 不可达时 getAppUpdateInfo() 返回 null，这里仍返回完整结构的 null，
		// 前端据此降级（显示「暂时无法获取更新说明」），不阻塞更新入口。
		$latest_release = null;
		if (is_array($update_info['latest_release'] ?? null)) {
			$release = $update_info['latest_release'];
			// 逐字段归一化：缓存缺字段时也保证结构完整，老前端不读新字段同样不受影响
			$latest_release = [
				'name' => $release['name'] ?? null,
				'body' => $release['body'] ?? null,
				'published_at' => $release['published_at'] ?? null,
				'html_url' => $release['html_url'] ?? null,
			];
		}

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
			'latest_release' => $latest_release,
		]);
	}
}
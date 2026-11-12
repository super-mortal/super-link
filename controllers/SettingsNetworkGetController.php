<?php

namespace Controllers;

use Config;
use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use function Framework\success;

/**
 * 读取「设置 → 网络」的 GitHub 访问配置（PRD optimization.md O-5）
 *
 * 返回的是生效值：app_settings 表优先，环境变量只作为初始默认值；
 * 非法配置已在 Config 读取端归一化（回退直连并写 error_log），这里不会再失败。
 */
class SettingsNetworkGetController implements ControllerInterface
{

	public function __invoke(array $input): ResponseInterface
	{
		return success('网络设置获取成功', [
			'mode' => Config::getGithubAccessMode(),
			'proxy_prefix' => Config::getGithubProxyPrefix(),
			'update_check' => Config::isAppUpdateCheckEnabled(),
		]);
	}
}

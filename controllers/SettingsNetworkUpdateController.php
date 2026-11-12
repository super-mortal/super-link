<?php

namespace Controllers;

use Config;
use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\success;

/**
 * 保存「设置 → 网络」的 GitHub 访问配置（PRD optimization.md O-5）
 *
 * 校验与 Config 读取端的归一化规则保持一致：非法输入直接 400 拒绝，不写库；
 * 读取端还会再兜底一次（回退直连并写 error_log），双保险避免坏配置让应用不可用。
 */
class SettingsNetworkUpdateController implements ControllerInterface
{

	public function __invoke(array $input): ResponseInterface
	{
		$mode = $this->normalizeMode($input['mode'] ?? null);
		$prefix = $this->normalizePrefix($input['proxy_prefix'] ?? null);
		$update_check = filter_var($input['update_check'] ?? true, FILTER_VALIDATE_BOOLEAN);

		$repository = ServiceContainer::get(Repository::class);
		$saved = $repository->setAppSetting(Config::SETTING_KEY_GITHUB_ACCESS_MODE, $mode)
			&& $repository->setAppSetting(Config::SETTING_KEY_GITHUB_PROXY_PREFIX, $prefix)
			&& $repository->setAppSetting(Config::SETTING_KEY_APP_UPDATE_CHECK, $update_check ? '1' : '0');

		if (!$saved) {
			throw new DataWriteException('网络设置保存失败，请检查数据库文件是否可写');
		}

		// 同一请求内的后续读取（例如保存后立刻安装 Skill）要立刻看到新值
		Config::clearSettingsCache();

		return success('网络设置已保存', [
			'mode' => $mode,
			'proxy_prefix' => $prefix,
			'update_check' => $update_check,
		]);
	}

	private function normalizeMode(mixed $raw): string
	{
		$mode = is_string($raw) ? strtolower(trim($raw)) : '';
		if (!in_array($mode, ['auto', 'proxy', 'direct'], true)) {
			throw new ValidationException('访问策略无效，仅支持 auto / proxy / direct');
		}

		return $mode;
	}

	private function normalizePrefix(mixed $raw): string
	{
		$prefix = is_string($raw) ? trim($raw) : '';
		if ($prefix === '') {
			return '';
		}

		$normalized = Config::normalizeGithubProxyPrefix($prefix);
		if ($normalized === null) {
			throw new ValidationException('代理地址必须以 https:// 开头，且不能包含用户名、密码、查询参数或片段');
		}

		return $normalized;
	}
}

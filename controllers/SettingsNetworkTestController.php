<?php

namespace Controllers;

use Config;
use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\TransferException;
use function Framework\success;

/**
 * 「设置 → 网络」的测试连接（PRD optimization.md O-5）
 *
 * 已确认决策：只做 HEAD 探测，不执行真实 clone——避免产生目录、耗时过长或触发仓库下载。
 * 探测目标固定为 https://github.com（走代理时追加代理前缀），不接受任意 URL，
 * 代理只能作用于 github.com / codeload.github.com，不借此探测其他主机。
 */
class SettingsNetworkTestController implements ControllerInterface
{
	const TEST_TARGET = 'https://github.com';
	const TIMEOUT_SECONDS = 10;
	const CONNECT_TIMEOUT_SECONDS = 5;

	public function __invoke(array $input): ResponseInterface
	{
		$mode = is_string($input['mode'] ?? null) ? strtolower(trim($input['mode'])) : '';
		if (!in_array($mode, ['auto', 'proxy', 'direct'], true)) {
			throw new ValidationException('访问策略无效，仅支持 auto / proxy / direct');
		}

		$raw_prefix = is_string($input['proxy_prefix'] ?? null) ? trim($input['proxy_prefix']) : '';
		$prefix = $raw_prefix === '' ? '' : Config::normalizeGithubProxyPrefix($raw_prefix);
		if ($prefix === null) {
			throw new ValidationException('代理地址必须以 https:// 开头，且不能包含用户名、密码、查询参数或片段');
		}

		// 代理档位未填地址时不发请求并明确提示；auto 未填地址时退化为直连探测
		if ($mode === 'proxy' && $prefix === '') {
			throw new ValidationException('当前为「始终使用代理」，请先填写代理地址');
		}

		$target = ($prefix !== '' && $mode !== 'direct')
			? $prefix . self::TEST_TARGET
			: self::TEST_TARGET;

		$started_at = microtime(true);
		$elapsed_ms = static fn(): int => (int)round((microtime(true) - $started_at) * 1000);

		try {
			$client = new Client([
				'timeout' => self::TIMEOUT_SECONDS,
				'connect_timeout' => self::CONNECT_TIMEOUT_SECONDS,
			]);
			$response = $client->request('HEAD', $target, ['http_errors' => false]);
			$status_code = $response->getStatusCode();
		} catch (TransferException $e) {
			// 探测失败也是有效结果：原样返回不可达与原因，不按 5xx 处理
			return success('测试完成', [
				'reachable' => false,
				'target' => $target,
				'elapsed_ms' => $elapsed_ms(),
				'error' => $this->describeError($e),
			]);
		}

		if ($status_code >= 400) {
			return success('测试完成', [
				'reachable' => false,
				'target' => $target,
				'elapsed_ms' => $elapsed_ms(),
				'error' => sprintf('目标返回 HTTP %d', $status_code),
			]);
		}

		return success('测试完成', [
			'reachable' => true,
			'target' => $target,
			'elapsed_ms' => $elapsed_ms(),
			'error' => null,
		]);
	}

	/**
	 * 把 Guzzle 的 cURL 底层错误翻译成用户可读的原因
	 */
	private function describeError(TransferException $e): string
	{
		$message = $e->getMessage();

		if (str_contains($message, 'Could not resolve host') || str_contains($message, 'Resolving timed out')) {
			return 'DNS 解析失败';
		}
		if (str_contains($message, 'Operation timed out') || str_contains($message, 'Connection timed out')) {
			return '连接超时';
		}
		if (str_contains($message, 'Connection refused')) {
			return '连接被拒绝';
		}
		if (str_contains($message, 'SSL certificate problem') || str_contains($message, 'certificate verify failed')) {
			return 'TLS 证书校验失败';
		}

		return mb_substr($message, 0, 200);
	}
}

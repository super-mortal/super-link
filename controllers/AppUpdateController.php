<?php

namespace Controllers;

use Config;
use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use GuzzleHttp\Client;
use function Framework\success;

class AppUpdateController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		$watchtower_url = Config::getWatchtowerUrl();
		$watchtower_token = Config::getWatchtowerToken();

		if (empty($watchtower_token)) {
			throw new ValidationException('自动更新未配置，请手动更新');
		}

		$client = new Client(['timeout' => 20, 'http_errors' => false]);

		try {
			$response = $client->post($watchtower_url . '/v1/update', [
				'query' => [
					'container' => 'web-app',
					'async' => 'true',
				],
				'headers' => [
					'Authorization' => 'Bearer ' . $watchtower_token,
				],
			]);
		} catch (\Exception $e) {
			throw new ValidationException('无法连接更新服务，请确认 Watchtower 是否正常运行');
		}

		$status_code = $response->getStatusCode();
		if ($status_code !== 202 && $status_code !== 200) {
			throw new ValidationException('更新触发失败，请稍后重试');
		}

		return success('更新已触发，应用正在重启，页面很快会自动刷新。');
	}
}

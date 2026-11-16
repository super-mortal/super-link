<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\NotFoundException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\ServerPayload;
use Utils\ServerToken;
use function Framework\success;

class ServersPostController implements ControllerInterface
{
	/**
	 * POST /api/servers
	 *
	 * 新增服务器（PRD §5.1 / §6）：生成服务器与 Agent Token，返回明文 Token
	 * （仅此一次）与一行安装命令。入库的只有 SHA-256(盐 + Token) 与盐本身，
	 * Token 明文不落库、不写日志（PRD §5.6 / D6 选项 b）。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		// 响应体含 Token 明文，禁止任何缓存：浏览器 / 代理把它存下来，
		// 等于把 agent 凭据复制到了第二处（PRD §5.6）
		header('Cache-Control: no-store');

		$repository = ServiceContainer::get(Repository::class);

		$payload = ServerPayload::parseCreate($input);

		$token = ServerToken::generate();
		$salt = ServerToken::generateSalt();

		$id = $repository->createServer([
			...$payload,
			'token_hash' => ServerToken::hash($token, $salt),
			'token_salt' => $salt,
		]);

		if ($id <= 0) {
			throw new DataWriteException('服务器创建失败，请稍后重试');
		}

		// 回读一次再返回：created_at / updated_at 由服务端写入，前端拿到的必须与库里一致
		$row = $repository->getServerById($id);

		if (!$row) {
			throw new NotFoundException('服务器不存在');
		}

		$server = ServerPayload::formatServer($row);
		// 新服务器 agent 尚未连接，状态必然是「等待连接」（PRD §5.1）
		$server['status'] = ServerPayload::resolveStatus($server['paused'], false, null);

		return success('服务器创建成功', [
			'server' => $server,
			// Token 明文只在这一次响应里完整出现，之后任何接口都不再返回；
			// 丢失只能走「重置 Token」（task 后续实现），旧 Token 立即失效
			'token' => $token,
			'install_command' => $this->buildInstallCommand($token),
		]);
	}

	/**
	 * 组装一行安装命令（PRD §5.1 / §5.2）
	 *
	 * 格式与 mockups/app.js 的 agentInstallCmd 一致：Hub 托管的安装脚本自动识别
	 * 架构（amd64 / arm64）、下载对应 link-agent 静态二进制、写入
	 * /etc/link-agent/config（HUB_URL 与 AGENT_TOKEN）并注册 systemd 服务。
	 * /content/install-agent 由 Apache rewrite 转发到 api/index.php（PRD §5.2），
	 * 该内容路由的注册与脚本实体在后续任务完成。
	 *
	 * Token 直接嵌入命令无需 shell 转义：base64url 字符集（字母 / 数字 / - / _）
	 * 不含 shell 特殊字符，双引号内可安全传递——这正是 Token 选 base64url 而非
	 * 普通 base64（+ / = 需转义）的原因之一。
	 */
	private function buildInstallCommand(string $token): string
	{
		$hub_url = $this->resolveHubUrl();

		return 'curl -fsSL "' . $hub_url . '/content/install-agent" | sudo bash -s -- --hub-url "' . $hub_url . '" --token "' . $token . '"';
	}

	/**
	 * 推导 Hub 对外地址
	 *
	 * 项目当前没有 hub 地址配置项（PRD 未定义，AppInfo / settings 里也没有现成机制），
	 * 因此按请求推导：协议看 X-Forwarded-Proto（Hub 前置 nginx / Caddy 时以反代
	 * 透传的协议为准）→ HTTPS → REQUEST_SCHEME；Host 取 HTTP_HOST（浏览器视角，
	 * 含非标准端口），缺失时退到 SERVER_NAME + SERVER_PORT。agent 与 Hub 同域
	 * 部署时该地址即被监控机可达的地址；若后续内外网分离需要显式配置，在这里换成
	 * Config 读取即可，安装命令格式不变。
	 */
	private function resolveHubUrl(): string
	{
		$scheme = 'http';
		$forwarded_proto = strtolower(trim((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')));

		if (in_array($forwarded_proto, ['http', 'https'], true)) {
			$scheme = $forwarded_proto;
		} elseif (!empty($_SERVER['HTTPS']) && 'off' !== $_SERVER['HTTPS']) {
			$scheme = 'https';
		} elseif (in_array(strtolower((string)($_SERVER['REQUEST_SCHEME'] ?? '')), ['http', 'https'], true)) {
			$scheme = strtolower((string)$_SERVER['REQUEST_SCHEME']);
		}

		$host = trim((string)($_SERVER['HTTP_HOST'] ?? ''));

		if ('' === $host) {
			$host = trim((string)($_SERVER['SERVER_NAME'] ?? '')) ?: 'localhost';
			$port = (int)($_SERVER['SERVER_PORT'] ?? 0);

			if ($port > 0 && 80 !== $port && 443 !== $port) {
				$host .= ':' . $port;
			}
		}

		return $scheme . '://' . $host;
	}
}

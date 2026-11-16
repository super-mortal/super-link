<?php

namespace Utils;

/**
 * Agent 安装命令的组装（PRD §5.1 / §5.2）
 *
 * 新增（POST /api/servers）与重置 Token（POST /api/servers/token）返回
 * 同一形态的一行安装命令。Hub 地址推导与命令拼装只保留这一份实现：
 * 新增端点最初把这两段写成控制器私有方法，重置端点再用一次就会出现
 * 「改了一处忘了另一处」的漂移，故抽到此处共用（与 ServerPayload /
 * AccountPayload 同一模式：跨端点共用逻辑放 Utils 静态方法）。
 */
class ServerInstallCommand
{
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
	public static function build(string $token): string
	{
		$hub_url = self::resolveHubUrl();

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
	private static function resolveHubUrl(): string
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

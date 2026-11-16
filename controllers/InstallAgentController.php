<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use RuntimeException;
use Utils\ServerInstallCommand;

/**
 * GET /content/install-agent —— 下发 link-agent 安装脚本（PRD docs/prd/server.md §5.2 / §6）
 *
 * 被监控机（尚未安装 agent，也没有任何 super-link 凭据）执行一行命令即可接入：
 *   curl -fsSL "<Hub 地址>/content/install-agent" | sudo bash -s -- --hub-url "<Hub 地址>" --token "<Agent Token>"
 * 完整命令由用户态新增 / 重置 Token 端点经 Utils\ServerInstallCommand 组装，
 * 其中的 Hub 地址与本端点注入脚本的是同一推导（见下方注入说明）。
 *
 * 路由形态：顶层 content 键而非 api 子键——Apache 把 /content/* 与 /api/* 一并
 * 转发到 index.php，SCRIPT_URL 原样参与路由匹配（PRD §6）。该端点已由 task5
 * 加入认证 / CSRF 中间件豁免名单与 bootstrap 的 session 跳过：被监控机未登录
 * 也要能下载，因此控制器内不调用任何 session API，也不依赖数据库。
 *
 * 响应：200，Content-Type: text/x-shellscript，body 即仓库根
 * agent/install-agent.sh 的脚本文本（该文件是单一事实源：CI 发布
 * link-agent 双架构二进制的资产命名也以它为准，决策 D12）。不设
 * Content-Disposition——curl | bash 场景需要正文直接进管道，存盘不是预期用法。
 *
 * Hub 地址注入：把脚本内的 __HUB_URL__ 占位符替换为按请求推导的 Hub 对外
 * 地址（PRD §5.2「可顺带注入 Hub 地址」），被监控机即使漏传 --hub-url 也能
 * 安装。脚本（task4）对未被替换的占位符（值仍以 __ 开头）会置空并继续向
 * --hub-url 参数、HUB_URL 环境变量回落，都不给时明确报错——因此注入未发生
 * 时的回落是安全的，不会静默装出一个连错地方的 agent。
 *
 * 安全边界（公开端点，无任何认证，调用方完全不可信）：
 * - 只返回静态脚本 + 推导的 Hub 地址，响应内容与具体服务器无关，不返回任何
 *   Token / 哈希 / 用户数据——Token 明文只在用户态新增 / 重置响应里完整出现
 *   一次（PRD D6），本端点永远接触不到，脚本内也只会把 Token 写进被监控机
 *   本地配置文件，不回显；
 * - 注入值最终进入 root 执行的 shell 赋值语句，而 Hub 地址推导自调用方可控的
 *   请求头（X-Forwarded-Proto / Host），故注入前按「协议://主机[:端口]」白名单
 *   校验，拒绝一切可破坏引用的字符（见 __invoke 内注释）；
 * - 限流不在本任务范围（PRD 未要求）：脚本极小且响应与请求参数无关，个人级
 *   场景（被监控机数量有限）可接受；后续如需要，应在中间件层按 IP 统一加，
 *   而不是在本控制器里写一套。
 */
class InstallAgentController implements ControllerInterface
{
	/**
	 * 安装脚本内的 Hub 地址占位符（task4 与脚本约定的注入契约）
	 */
	private const HUB_URL_PLACEHOLDER = '__HUB_URL__';

	public function __invoke(array $input): ResponseInterface
	{
		$script = $this->readScript();

		// 与安装命令（POST /api/servers、POST /api/servers/token）同一推导：
		// 两个出口必须是同一个 Hub 地址，否则命令里连 A、脚本回落连 B
		$hub_url = ServerInstallCommand::resolveHubUrl();

		// 注入值安全闸：地址最终进入脚本的 INJECTED_HUB_URL='<url>' 这一 shell
		// 单引号赋值（脚本以 root 执行），只放行「协议://主机[:端口]」——域名 /
		// IPv4 / [IPv6] 主机名加可选数字端口；单引号、$、反引号、空白等可破坏
		// 引用或触发命令替换的字符一律拒绝。不放行即不注入：占位符原样保留，
		// 脚本内置回落将其置空，安装时明确报错要求传 --hub-url，不会带着畸形
		// 地址继续跑
		if (1 === preg_match('#^https?://(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+)(:[0-9]{1,5})?$#', $hub_url)) {
			// 占位符在脚本里出现两次：注入点本身与上方解释性注释。注释内那次
			// 一并替换无害（bash 忽略 # 开头的行）；脚本后续改版若移除占位符，
			// str_replace 自然无操作，原样返回
			$script = str_replace(self::HUB_URL_PLACEHOLDER, $hub_url, $script);
		}

		// 正文直接输出（curl | bash 进管道）；禁止缓存：内容含按请求推导的 Hub
		// 地址且随部署版本变化，浏览器 / 共享代理缓存可能下发另一台 Hub 的地址
		// 或旧版脚本（缓存头与框架 DataResponse 一致）
		http_response_code(200);
		header('Content-Type: text/x-shellscript; charset=utf-8');
		header('Cache-Control: no-cache, no-store, must-revalidate');
		header('Pragma: no-cache');
		echo $script;

		// 响应体已输出完毕：返回空 yield() 的响应，避免框架的标准响应再发一次
		// 头部（headers already sent）与响应体。用匿名类而不是改框架：本任务的
		// 改动范围只有本文件（与 AgentConnectController 流式输出同一手法）
		return new class implements ResponseInterface {
			public function yield(): void
			{
				// 状态码 / 头部 / 响应体均由控制器直接输出
			}
		};
	}

	/**
	 * 读取仓库根 agent/install-agent.sh（单一事实源，PRD §5.2）
	 *
	 * ROOT_DIR 在 public/api/index.php 定义为项目根：宿主机即仓库根；镜像内
	 * Dockerfile.build stage 3 已把该文件 COPY 到 /var/www/html/agent/ 下，
	 * 与 ROOT_DIR 的解析结果一致。文件缺失 / 不可读属于部署事故（如镜像漏
	 * COPY），必须 500 + error_log 显式失败——静默返回空脚本会让被监控机执行
	 * 空内容，「命令没报错但 agent 没装上」，极难排查
	 */
	private function readScript(): string
	{
		$script_path = ROOT_DIR . '/agent/install-agent.sh';

		$script = is_file($script_path) && is_readable($script_path)
			? file_get_contents($script_path)
			: false;

		if (!is_string($script) || '' === $script) {
			error_log(sprintf('[InstallAgent] 安装脚本缺失或不可读：%s', $script_path));

			throw new RuntimeException('安装脚本缺失或读取失败，请检查 Hub 服务端部署（agent/install-agent.sh）');
		}

		return $script;
	}
}

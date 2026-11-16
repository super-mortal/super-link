<?php

use Controllers\AccountsAuthorizationsCreateController;
use Controllers\AccountsAuthorizationsDeleteController;
use Controllers\AccountsAuthorizationsUpdateController;
use Controllers\AccountsCreateController;
use Controllers\AccountsDeleteController;
use Controllers\AccountsDetailGetController;
use Controllers\AccountsGetController;
use Controllers\AccountsUpdateController;
use Controllers\AppInfoController;
use Controllers\AppUpdateController;
use Controllers\AuthLoginController;
use Controllers\AuthLogoutController;
use Controllers\ExportDataController;
use Controllers\ImportBookmarksController;
use Controllers\ImportDataController;
use Controllers\ImportPocketController;
use Controllers\ItemsCreateController;
use Controllers\ItemsDeleteController;
use Controllers\ItemsFetchMetadataController;
use Controllers\ItemsGetController;
use Controllers\ItemsTagsUpdateController;
use Controllers\ItemsUpdateController;
use Controllers\ServersDeleteController;
use Controllers\ServersDetailController;
use Controllers\ServersGetController;
use Controllers\ServersMetricsController;
use Controllers\ServersPatchController;
use Controllers\ServersPostController;
use Controllers\ServersTokenController;
use Controllers\SetupDatabaseController;
use Controllers\SettingsNetworkGetController;
use Controllers\SettingsNetworkTestController;
use Controllers\SettingsNetworkUpdateController;
use Controllers\SkillsCheckUpdatesController;
use Controllers\SkillsDeleteController;
use Controllers\SkillsDetailController;
use Controllers\SkillsExportController;
use Controllers\SkillsGetController;
use Controllers\SkillsInstallController;
use Controllers\SkillsTagsUpdateController;
use Controllers\SkillsUpdateController;
use Controllers\SkillsUploadController;
use Controllers\TagsController;
use Controllers\TagsCreateController;
use Controllers\TagsDeleteController;
use Controllers\TagsUpdateColorController;
use Controllers\TagsUpdateController;
use Controllers\TagsUpdatePinnedController;
use Controllers\UrlMetadataController;
use Controllers\UserCreateController;
use Controllers\UserDeleteController;
use Controllers\UserGetController;
use Controllers\UserPasswordUpdateController;
use Controllers\UserUsernameUpdateController;
use Controllers\VaultChangeMasterController;
use Controllers\VaultExportController;
use Controllers\VaultImportController;
use Controllers\VaultMetaGetController;
use Controllers\VaultResetController;
use Controllers\VaultSetupController;

return [
	'api' => [
		'items' => [
			'/' => [
				'GET' => ItemsGetController::class,
				'POST' => ItemsCreateController::class,
				'PATCH' => ItemsUpdateController::class,
			],
			'delete' => [
				'POST' => ItemsDeleteController::class,
			],
			'fetch-metadata' => [
				'POST' => ItemsFetchMetadataController::class,
			],
			'tags' => [
				'PATCH' => ItemsTagsUpdateController::class,
			],
		],
		'skills' => [
			'/' => [
				'GET' => SkillsGetController::class,
			],
			'check-updates' => [
				'POST' => SkillsCheckUpdatesController::class,
			],
			'delete' => [
				'POST' => SkillsDeleteController::class,
			],
			'detail' => [
				'GET' => SkillsDetailController::class,
			],
			'export' => [
				'GET' => SkillsExportController::class,
			],
			'install' => [
				'POST' => SkillsInstallController::class,
			],
			'tags' => [
				'PATCH' => SkillsTagsUpdateController::class,
			],
			'update' => [
				'POST' => SkillsUpdateController::class,
			],
			'upload' => [
				'POST' => SkillsUploadController::class,
			],
		],
		'tags' => [
			'/' => [
				'GET' => TagsController::class,
				'POST' => TagsCreateController::class,
				'DELETE' => TagsDeleteController::class,
			],
			'update' => [
				'PATCH' => TagsUpdateController::class,
			],
			'update-pinned' => [
				'PATCH' => TagsUpdatePinnedController::class,
			],
			'update-color' => [
				'PATCH' => TagsUpdateColorController::class,
			],
		],
		'settings' => [
			'user' => [
				'GET' => UserGetController::class,
				'POST' => UserCreateController::class,
				'DELETE' => UserDeleteController::class,
			],
			'username' => [
				'PATCH' => UserUsernameUpdateController::class,
			],
			'password' => [
				'PATCH' => UserPasswordUpdateController::class,
			],
			// GitHub 网络访问三档设置（PRD O-5）：设置页「网络」分区，
			// 保存进 app_settings 表；测试连接只做 HEAD 探测
			'network' => [
				'GET' => SettingsNetworkGetController::class,
				'POST' => SettingsNetworkUpdateController::class,
				'test' => [
					'POST' => SettingsNetworkTestController::class,
				],
			],
		],
		'auth' => [
			'login' => [
				'POST' => AuthLoginController::class,
			],
			'logout' => [
				'POST' => AuthLogoutController::class
			],
		],
		// 账号库元信息（PRD §8.1）：只处理 KDF 参数与密文，不返回任何账号明文
		'vault' => [
			'meta' => [
				'GET' => VaultMetaGetController::class,
			],
			'setup' => [
				'POST' => VaultSetupController::class,
			],
			'change-master' => [
				'POST' => VaultChangeMasterController::class,
			],
			'reset' => [
				'POST' => VaultResetController::class,
			],
			// 加密备份：导出只出密文（响应体即 .slvault 文件内容）；
			// 导入为 multipart 上传（file + mode），主密码校验在浏览器完成
			'export' => [
				'GET' => VaultExportController::class,
			],
			'import' => [
				'POST' => VaultImportController::class,
			],
		],
		// 账号（PRD §8.2）：只处理元数据与密文，任何端点都不返回明文
		'accounts' => [
			'/' => [
				'GET' => AccountsGetController::class,
				'POST' => AccountsCreateController::class,
				'PATCH' => AccountsUpdateController::class,
			],
			'detail' => [
				'GET' => AccountsDetailGetController::class,
			],
			'delete' => [
				'POST' => AccountsDeleteController::class,
			],
			// 授权关系（PRD §8.2）：新增走 /authorizations，更新与删除各占一个子路径。
			// 更新不并入新增端点做 upsert —— 路径即语义，避免编辑弹窗残留 id 时静默覆盖别的记录
			'authorizations' => [
				'POST' => AccountsAuthorizationsCreateController::class,
				'update' => [
					'POST' => AccountsAuthorizationsUpdateController::class,
				],
				'delete' => [
					'POST' => AccountsAuthorizationsDeleteController::class,
				],
			],
		],
		// 服务器监控（PRD docs/prd/server.md）：用户态管理接口（会话认证）。
		// 列表 / 新增 / 更新挂在 /api/servers，删除走 /api/servers/delete（POST，与
		// items / accounts / skills 的删除端点一致）；id 一律查询串或 body 传递
		// （Router 无路径参数，PRD §6 已按该惯例定稿）。agent 态端点
		// （/api/agent/connect、/api/agent/report、/content/install-agent）在后续
		// 任务注册，届时需同步加入认证与 CSRF 跳过名单
		'servers' => [
			'/' => [
				'GET' => ServersGetController::class,
				'POST' => ServersPostController::class,
				'PATCH' => ServersPatchController::class,
			],
			'delete' => [
				'POST' => ServersDeleteController::class,
			],
			// 详情 / 历史指标 / 重置 Token（PRD §6）：id 与 range 均走查询串，
			// 与 detail= 的 accounts / skills 端点惯例一致；token 为 POST
			// （写操作，需 CSRF 头），响应含 Token 明文且 no-store
			'detail' => [
				'GET' => ServersDetailController::class,
			],
			'metrics' => [
				'GET' => ServersMetricsController::class,
			],
			'token' => [
				'POST' => ServersTokenController::class,
			],
		],
		'setup' => [
			'database' => [
				'POST' => SetupDatabaseController::class
			],
		],
		'export' => [
			'data' => [
				'GET' => ExportDataController::class,
			],
		],
		'import' => [
			'pocket' => [
				'POST' => ImportPocketController::class,
			],
			'bookmarks' => [
				'POST' => ImportBookmarksController::class,
			],
			'data' => [
				'POST' => ImportDataController::class,
			],
		],
		'url' => [
			'fetch-metadata' => [
				'POST' => UrlMetadataController::class,
			],
		],
		'app-info' => [
			'GET' => AppInfoController::class,
		],
		'app' => [
			'update' => [
				'POST' => AppUpdateController::class,
			],
		],
	],
];

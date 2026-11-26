<?php

namespace Utils;

use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\ValidationException;
use Models\Repository;
use PDO;
use Throwable;

/**
 * 服务器恢复器（refinements.md §4.2 / §4.3 / §4.5 / dev-spec §6.4、§6.5）
 *
 * 与 BookmarkRestorer / SkillBackupRestorer 同一分层：解析校验（parse）、预检
 * （dry_run）、执行（merge / overwrite）集中在这里，控制器只负责上传取值与响应组装。
 *
 * 凭据边界（PRD §4.4）：备份里的 token_hash / token_salt 等同于 agent 凭据，
 * 恢复时「原样」写回 servers 表，绝不重新生成——Hub 地址不变时 agent 手里的旧
 * Token 仍能通过 ServerToken::verify，无需重装（dev-spec §6.4）。由此推出三条硬约束：
 *   - 本类不输出、不记录哈希 / 盐：结果只含 name / status / message，异常信息里
 *     也不带凭据字段（日志出现盐 = 凭据落盘）；
 *   - 缺 token_hash / token_salt 的条目在 parse() 阶段直接 400，绝不静默生成新
 *     Token：新 Token 没有明文交付渠道，agent 会立刻 401 断连且用户无从判断原因；
 *     也不允许空凭据落库（verify 永远失败，等于恢复出一台无法接入的服务器）；
 *   - 凭据只在服务端内存与数据库之间流动，用户态响应走 ServerPayload 白名单，
 *     本类不参与任何响应格式化。
 *
 * 覆盖模式（overwrite）的破坏性：同名服务器按备份更新（note / group / paused /
 * Token 材料），并删除备份之外的服务器。删除必须复用 Repository::deleteServer()，
 * 由它连带清空 server_connections / server_metrics / server_disks / server_docker
 * （本项目未开启外键级联，手写四张表的 DELETE 必然与删除端点漂移）。整个执行阶段
 * 包在一个事务里，任何一步失败都整体回滚，不留下「改了一半 / 删了一半」的不可用状态。
 *
 * 不恢复历史指标 / 磁盘 / Docker 快照（PRD §6.3：服务器恢复不含历史指标）：
 * 备份文件不含这些数据，agent 重连后会重新采集。
 */
class ServerBackupRestorer
{
	public const MODE_MERGE = 'merge';
	public const MODE_OVERWRITE = 'overwrite';

	/**
	 * 恢复边界说明（随结果返回，与 SkillBackupRestorer::BOUNDARY_NOTE 同一用途）
	 *
	 * 固定文案放在后端：前端不必自己拼措辞，也不会与后端语义漂移。
	 */
	public const BOUNDARY_NOTE = '合并模式同名服务器跳过；覆盖模式同名按备份更新，并删除备份外的服务器（含运行态与历史数据）；备份不含历史指标。';

	public function __construct(
		protected Repository $repository,
		protected PDO $pdo
	) {
	}

	/**
	 * 解析并校验备份文件内容，返回规范化后的数据（servers 重排为顺序数组）
	 *
	 * 所有失败都在这里抛 ValidationException(400)，因此预检与执行都会在写库前被
	 * 拦截：空文件 / JSON 解析失败 / 缺 module / module 不匹配 / 版本不支持 /
	 * 缺 servers / 条目缺 name 或 Token 材料。
	 *
	 * 条目校验直接复用 ServerPayload::parseCreate()（名称必填与长度上限、备注上限），
	 * 避免恢复端另写一套规则与新增端点漂移。分组在此不做字典校验（传空名称列表）：
	 * §3.4 要求恢复时字典外的分组名自动建组，不能在解析阶段就 400。正常导出的文件
	 * 必然通过，失败说明文件被改写或来自不兼容版本。
	 */
	public function parse(string $content): array
	{
		if (trim($content) === '') {
			throw new ValidationException('恢复失败：备份文件为空', 400);
		}

		$data = json_decode($content, true);
		if (json_last_error() !== JSON_ERROR_NONE) {
			throw new ValidationException('恢复失败：备份文件不是有效的 JSON', 400);
		}
		if (!is_array($data)) {
			throw new ValidationException('恢复失败：备份文件格式不正确', 400);
		}

		// 新恢复端点严格校验 module：缺失一律 400（旧 /api/import/data 的默认值
		// 适配层只作用于旧端点，见 dev-spec §6.5）
		if (!isset($data['module']) || $data['module'] === '') {
			throw new ValidationException('恢复失败：缺少 module 字段', 400);
		}
		if ($data['module'] !== 'servers') {
			throw new ValidationException('恢复失败：备份文件不属于服务器模块', 400);
		}

		// version：只接受当前格式版本；高版本可能在字段语义上不兼容
		$version = $data['version'] ?? null;
		if (!is_int($version) && !(is_string($version) && ctype_digit($version))) {
			throw new ValidationException('恢复失败：缺少或非法的 version 字段', 400);
		}
		$version = (int)$version;
		if ($version < 1 || $version > BackupPayload::VERSION) {
			throw new ValidationException("恢复失败：不支持的备份版本 {$version}", 400);
		}
		$data['version'] = $version;

		if (!isset($data['servers']) || !is_array($data['servers'])) {
			throw new ValidationException('恢复失败：缺少 servers 字段', 400);
		}

		$servers = [];
		// 统一重排为顺序数组：备份文件理论上就是数组，历史文件若写成对象也能按序处理
		foreach (array_values($data['servers']) as $index => $server) {
			$label = '第 ' . ($index + 1) . ' 个服务器';

			if (!is_array($server)) {
				throw new ValidationException('恢复失败：' . $label . '格式不正确', 400);
			}

			try {
				// 空名称列表 = 不校验分组字典：字典外分组按 §3.4 由恢复器自动建组
				$meta = ServerPayload::parseCreate($server, []);
			} catch (ValidationException $e) {
				throw new ValidationException('恢复失败：' . $label . '配置不合法（' . $e->getMessage() . '）', 400);
			}

			// 凭据必填：备份来自导出端点，token_hash / token_salt 恒为非空字符串；
			// 缺任一项都说明文件不完整，不能靠「生成新 Token」掩盖（会让 agent 断连）
			$token_hash = $server['token_hash'] ?? null;
			$token_salt = $server['token_salt'] ?? null;
			if (!is_string($token_hash) || trim($token_hash) === '') {
				throw new ValidationException('恢复失败：' . $label . '缺少 Token 凭据（token_hash），无法保证 agent 免重装接入', 400);
			}
			if (!is_string($token_salt) || trim($token_salt) === '') {
				throw new ValidationException('恢复失败：' . $label . '缺少 Token 凭据（token_salt），无法保证 agent 免重装接入', 400);
			}

			try {
				// paused 缺省按未暂停处理（与建表默认值一致），显式非法值报 400
				$paused = array_key_exists('paused', $server) ? ServerPayload::parsePaused($server['paused']) : 0;
			} catch (ValidationException $e) {
				throw new ValidationException('恢复失败：' . $label . '配置不合法（' . $e->getMessage() . '）', 400);
			}

			// 分组：备份字段是 group（名称），由 parseCreate 映射为 group_name；
			// PRD §4.2 提到的 group_id 是内部列口径，dev-spec §6.4 明确不导出也不恢复，
			// 这里直接忽略，绝不把 group 当 group_id 用
			$servers[] = [
				'name' => $meta['name'],
				'note' => $meta['note'],
				'group_name' => $meta['group_name'],
				'paused' => $paused,
				'token_hash' => trim($token_hash),
				'token_salt' => trim($token_salt),
			];
		}

		$data['servers'] = $servers;

		return $data;
	}

	/**
	 * 预检或执行恢复
	 *
	 * @param array  $payload parse() 的返回值
	 * @param string $mode    merge（默认，同名跳过）/ overwrite（同名更新 + 清理备份外）
	 * @param bool   $dry_run true 只返回分类与逐条预览，不产生任何副作用
	 *
	 * 返回：{ dry_run, mode, note, removed, summary, groups_created, items }
	 * summary：{ new, updated, same, skipped, failed }（updated 预检恒为 0）；
	 * removed：删除（或将删除）的备份外服务器数量，merge 恒为 0；
	 * groups_created：字典外的分组名本次（或将）自动新建的数量，无新增时为 0。
	 * 与账号库导入同名字段同口径（dev-spec §4.1），前端恢复结果态统一消费。
	 */
	public function restore(array $payload, string $mode = self::MODE_MERGE, bool $dry_run = false): array
	{
		if (!in_array($mode, [self::MODE_MERGE, self::MODE_OVERWRITE], true)) {
			throw new ValidationException('恢复失败：mode 只能是 merge 或 overwrite', 400);
		}

		$servers = $payload['servers'];

		// 预检：只 SELECT 现有服务器做分类，不开事务、不写库、不删除，直接返回
		if ($dry_run) {
			return $this->preview($servers, $mode);
		}

		return $this->execute($servers, $mode);
	}

	/**
	 * 预检：按名称判断目标状态并给出逐条预览，不写库
	 *
	 * 分类口径：
	 *   - 名称不存在 → new（将按备份新建，沿用备份里的 Token 材料）；
	 *   - 同名 + merge → same（跳过，不覆盖现有配置）；
	 *   - 同名 + overwrite → same（执行阶段记为 updated）；
	 *   - 文件内同名重复 → 第一条后按 skipped。
	 *
	 * groups_created 只统计「真正会写库的条目」用到的字典外分组名：合并模式为
	 * 将新建的服务器，覆盖模式还包括将更新的同名服务器；被跳过 / 重复的条目
	 * 不建组，与 execute() 的实际行为保持一致，预检数字才不会被高估。
	 */
	private function preview(array $servers, string $mode): array
	{
		$existing = $this->existingServersByName();
		$group_names = $this->existingGroupNames();

		$counts = ['new' => 0, 'updated' => 0, 'same' => 0, 'skipped' => 0, 'failed' => 0];
		$items = [];
		$seen = [];
		$new_groups = [];

		foreach ($servers as $server) {
			$name = $server['name'];

			if (isset($seen[$name])) {
				$counts['skipped']++;
				$items[] = ['name' => $name, 'status' => 'skipped', 'message' => '备份文件中同名条目重复，已忽略'];
				continue;
			}
			$seen[$name] = true;

			if (!isset($existing[$name])) {
				$counts['new']++;
				$this->collectMissingGroup((string)$server['group_name'], $group_names, $new_groups);
				$items[] = ['name' => $name, 'status' => 'new', 'message' => '将新建服务器（沿用备份中的 Token 凭据）'];
				continue;
			}

			$counts['same']++;
			// 覆盖模式同名服务器会按备份更新分组，字典外分组同样要新建
			if (self::MODE_OVERWRITE === $mode) {
				$this->collectMissingGroup((string)$server['group_name'], $group_names, $new_groups);
			}
			$items[] = [
				'name' => $name,
				'status' => 'same',
				'message' => self::MODE_OVERWRITE === $mode ? '同名服务器，将按备份更新' : '同名服务器，合并模式下跳过',
			];
		}

		$note = self::BOUNDARY_NOTE;
		$removed = 0;
		if (self::MODE_OVERWRITE === $mode) {
			$removed = $this->countServersToRemove($existing, array_keys($seen));
			if ($removed > 0) {
				$note .= "（将删除备份外的 {$removed} 台服务器）";
			}
		}

		return [
			'dry_run' => true,
			'mode' => $mode,
			'note' => $note,
			'removed' => $removed,
			'summary' => $counts,
			'groups_created' => count($new_groups),
			'items' => $items,
		];
	}

	/**
	 * 执行恢复：单事务内新建 / 更新 / 清理，任一失败整体回滚
	 *
	 * Token 材料写回分两条语句：updateServer() 的列白名单不含 token_hash /
	 * token_salt（Token 轮换是独立流程），所以同名更新必须再调 updateServerToken()
	 * 原样覆盖；新建则直接经 createServer() 一次写入。
	 */
	private function execute(array $servers, string $mode): array
	{
		$existing = $this->existingServersByName();
		// 分组字典（名称集合）：写库前逐个补建字典外分组（refinements-v0.1.2 §3.4），
		// 新建后同步进这个集合，同一分组名在一次恢复里只建一次
		$group_names = $this->existingGroupNames();

		$counts = ['new' => 0, 'updated' => 0, 'same' => 0, 'skipped' => 0, 'failed' => 0];
		$items = [];
		$seen = [];
		$removed = 0;
		$groups_created = 0;

		// 整个执行阶段一个事务：写配置 + 写 Token 材料 + 清理备份外服务器必须同生共死。
		// deleteServer() 检测到已在外层事务里时会跳过自己的 begin / commit，
		// 由这里统一提交或回滚（PDO 嵌套 beginTransaction 会直接抛异常）
		$this->pdo->beginTransaction();

		try {
			foreach ($servers as $server) {
				$name = $server['name'];

				if (isset($seen[$name])) {
					$counts['skipped']++;
					$items[] = ['name' => $name, 'status' => 'skipped', 'message' => '备份文件中同名条目重复，已忽略'];
					continue;
				}
				$seen[$name] = true;

				if (isset($existing[$name])) {
					if (self::MODE_MERGE === $mode) {
						$counts['same']++;
						$items[] = ['name' => $name, 'status' => 'same', 'message' => '同名服务器，合并模式下跳过'];
						continue;
					}

					$id = (int)$existing[$name][0];
					// 先补建分组再更新：servers.group_name 是文本列，字典缺行时
					// 侧栏分组计数会把该服务器算丢
					if ($this->ensureServerGroup((string)$server['group_name'], $group_names)) {
						$groups_created++;
					}
					$this->repository->updateServer($id, [
						'note' => $server['note'],
						'group_name' => $server['group_name'],
						'paused' => $server['paused'],
					]);
					$this->repository->updateServerToken($id, $server['token_hash'], $server['token_salt']);

					$counts['updated']++;
					$items[] = ['name' => $name, 'status' => 'updated'];
					continue;
				}

				if ($this->ensureServerGroup((string)$server['group_name'], $group_names)) {
					$groups_created++;
				}
				$id = $this->repository->createServer([
					'name' => $name,
					'note' => $server['note'],
					'group_name' => $server['group_name'],
					'paused' => $server['paused'],
					'token_hash' => $server['token_hash'],
					'token_salt' => $server['token_salt'],
				]);
				if ($id <= 0) {
					throw new DataWriteException('恢复失败：创建服务器时出错');
				}

				$counts['new']++;
				$items[] = ['name' => $name, 'status' => 'new'];
			}

			// 覆盖模式：删除备份之外的服务器（含同名多出的重复行）。同名行只保留
			// 第一行（已按备份更新），其余重复行按「备份外」清理
			if (self::MODE_OVERWRITE === $mode) {
				foreach ($existing as $existing_name => $ids) {
					$extra_ids = isset($seen[$existing_name]) ? array_slice($ids, 1) : $ids;
					foreach ($extra_ids as $extra_id) {
						if (!$this->repository->deleteServer((int)$extra_id)) {
							throw new DataWriteException('恢复失败：清理备份外的服务器时出错');
						}
						$removed++;
					}
				}
			}

			$this->pdo->commit();
		} catch (Throwable $e) {
			if ($this->pdo->inTransaction()) {
				$this->pdo->rollBack();
			}
			if ($e instanceof ValidationException || $e instanceof DataWriteException) {
				throw $e;
			}
			// 不把底层 SQL 错误原文回给前端，避免暴露表结构；原因保留在 previous 里
			throw new DataWriteException('恢复失败：写入数据库时出错', 500, $e);
		}

		$note = self::BOUNDARY_NOTE;
		if (self::MODE_OVERWRITE === $mode && $removed > 0) {
			$note .= "（已删除备份外的 {$removed} 台服务器）";
		}

		return [
			'dry_run' => false,
			'mode' => $mode,
			'note' => $note,
			'removed' => $removed,
			'summary' => $counts,
			'groups_created' => $groups_created,
			'items' => $items,
		];
	}

	/**
	 * 现有服务器：名称 => id 列表
	 *
	 * 复用 getServers() 而不是新增专用方法：它返回 id / name 等全部所需列，且
	 * 走 SERVER_PUBLIC_COLUMNS 天然不含 token_hash / token_salt，预检阶段读它
	 * 不会把凭据带进内存。servers.name 没有唯一索引（新增端点不查重），同名多行时
	 * 保留全部 id：合并模式视为同名跳过，覆盖模式只更新第一行、其余按备份外清理。
	 *
	 * @return array<int|string, int[]>
	 */
	private function existingServersByName(): array
	{
		$map = [];
		foreach ($this->repository->getServers() as $row) {
			$map[(string)$row['name']][] = (int)$row['id'];
		}
		return $map;
	}

	/**
	 * 现有分组字典的名称列表（refinements-v0.1.2 §3.4 自动建组的判断依据）
	 *
	 * 只取名称：恢复只按名称写 servers.group_name，分组 id 是内部列、不参与恢复
	 * （与 parse() 忽略 group_id 的口径一致）。
	 *
	 * @return string[]
	 */
	private function existingGroupNames(): array
	{
		$names = [];
		foreach ($this->repository->getServerGroups() as $group) {
			$names[] = (string)$group['name'];
		}
		return $names;
	}

	/**
	 * 预检用：记录某个备份分组名是否需要新建（只记账，不写库）
	 *
	 * 空分组名表示备份里没有指定分组，写库时由 createServer() 回落字典默认值，
	 * 不需要建组；已在字典或已计入 $new_groups 的名称不重复计数。
	 */
	private function collectMissingGroup(string $group_name, array $group_names, array &$new_groups): void
	{
		if ('' === $group_name || in_array($group_name, $group_names, true) || isset($new_groups[$group_name])) {
			return;
		}

		$new_groups[$group_name] = true;
	}

	/**
	 * 执行用：字典外分组名按需建组，返回是否真的新建
	 *
	 * 走 Repository::createServerGroup()（sort = MAX(sort) + 1，追加到字典末尾），
	 * 与设置页添加分组同一入口，排序值稳定且不依赖名字哈希。新建后同步进
	 * $group_names，避免同一分组名在一次恢复里重复建组撞 UNIQUE 约束。
	 */
	private function ensureServerGroup(string $group_name, array &$group_names): bool
	{
		if ('' === $group_name || in_array($group_name, $group_names, true)) {
			return false;
		}

		$this->repository->createServerGroup($group_name);
		$group_names[] = $group_name;

		return true;
	}

	/**
	 * 统计覆盖模式将清理的服务器数量（预检用，不删除）
	 *
	 * @param array<int|string, int[]> $existing     existingServersByName() 的返回值
	 * @param string[]                 $backup_names 备份文件中出现过的服务器名称
	 */
	private function countServersToRemove(array $existing, array $backup_names): int
	{
		$kept = array_fill_keys($backup_names, true);
		$removed = 0;

		foreach ($existing as $name => $ids) {
			// 备份里有的名称只保留第一行，多出的重复行同样视为备份外
			$removed += isset($kept[$name]) ? max(0, count($ids) - 1) : count($ids);
		}

		return $removed;
	}
}

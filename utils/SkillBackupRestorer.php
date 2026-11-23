<?php

namespace Utils;

use Framework\Exceptions\ValidationException;
use Models\Repository;
use Throwable;

/**
 * Skill 恢复器（refinements.md §4.3 / dev-spec §6.3、§6.5）
 *
 * 恢复不复制文件：Skill 的正文在 storage/skills/，单文件备份无法携带，只能按备份里的
 * source_url 重新走 GitHub 安装流程拉取「最新版本」（dev-spec §6.3）。因此：
 *   - 同名且来源为 github：先 getSkillByName() 取现有行（含 id / 目录名），
 *     再交给 SkillInstaller::updateFromGithub($row) 拉取最新提交；
 *     payload 行本身没有 id，绝不能直接传给 updateFromGithub()；
 *   - 同名且来源为 upload：跳过且不删除——本地上传的 zip 内容不在备份里，
 *     覆盖等于销毁用户数据（dev-spec §1「不备份本地上传 Skill」）；
 *   - 不存在：按 source_url 调 installFromGithub() 重新安装。
 *
 * merge / overwrite 对 Skill 语义一致（dev-spec §6.3 / PRD §4.3）：同名一律覆盖为
 * 最新版本，**不会**删除备份之外的本地 Skill，也不动任何 Skill 标签（标签不在备份
 * 范围）。这一边界同时写进返回结果的 note 字段，避免前端把 overwrite 误解为整表清空。
 *
 * 预检（dry_run）与执行严格分流：dry_run 只做 SELECT（getSkillByName）与内存分类，
 * 不开事务、不写库、不触发 clone / fetch / 删文件，因此不会产生任何副作用。
 *
 * 单条失败隔离：GitHub 不可达、URL 非法、目录缺失等异常按条捕获，记为 failed
 * 并继续处理其余条目，最后在 summary.failed 汇总；SkillInstaller 抛出的
 * [SL-XXX-NNNN] 错误码原文透传到该条 message（dev-spec §5）。
 */
class SkillBackupRestorer
{
	public const MODE_MERGE = 'merge';
	public const MODE_OVERWRITE = 'overwrite';

	/**
	 * 恢复边界说明（随结果返回）
	 *
	 * overwrite 只改变同名 Skill 的版本，不删除备份外的条目；写成固定文案返回，
	 * 前端不必自己拼一份措辞，也不会与后端语义漂移。
	 */
	public const BOUNDARY_NOTE = '同名 GitHub Skill 会更新为最新版本；本地上传的同名 Skill 跳过且不受影响；备份之外的本地 Skill 与标签不会被删除。';

	public function __construct(
		protected Repository $repository,
		protected SkillInstaller $installer
	) {
	}

	/**
	 * 解析并校验备份文件内容
	 *
	 * 所有失败都在这里抛出 ValidationException(400)，因此预检与执行都会在
	 * 触碰文件系统 / 网络 / 数据库之前被拦截：空文件 / JSON 解析失败 / 缺 module /
	 * module 不匹配 / 版本不支持 / 缺 skills / 条目缺 name 或 source_url。
	 *
	 * 来源地址的合法性（是否 https://github.com 或 owner/repo）**不在这里**校验：
	 * 这类错误按条进入 failed（dev-spec §9「无效 source_url 观察逐条失败」），
	 * 不能让一条脏数据把整份备份打成 400。
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

		// 新恢复端点严格校验 module：缺失一律 400（旧 /api/import/data 的
		// module='bookmarks' 适配层只作用于旧端点，见 dev-spec §4 / §6.5）
		if (!isset($data['module']) || $data['module'] === '') {
			throw new ValidationException('恢复失败：缺少 module 字段', 400);
		}
		if ($data['module'] !== 'skills') {
			throw new ValidationException('恢复失败：备份文件不属于 Skill 模块', 400);
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

		if (!isset($data['skills']) || !is_array($data['skills'])) {
			throw new ValidationException('恢复失败：缺少 skills 字段', 400);
		}

		// 逐条校验：name 是判重键（getSkillByName），source_url 是重新拉取的唯一依据，
		// 缺任一都无法恢复，在预检阶段就 400，不进入安装分支
		foreach ($data['skills'] as $index => $skill) {
			if (!is_array($skill)) {
				throw new ValidationException('恢复失败：第 ' . ($index + 1) . ' 个 Skill 格式不正确', 400);
			}
			$name = $skill['name'] ?? null;
			if (!is_string($name) || trim($name) === '') {
				throw new ValidationException('恢复失败：第 ' . ($index + 1) . ' 个 Skill 缺少名称', 400);
			}
			$source_url = $skill['source_url'] ?? null;
			if (!is_string($source_url) || trim($source_url) === '') {
				throw new ValidationException('恢复失败：第 ' . ($index + 1) . ' 个 Skill 缺少来源地址', 400);
			}
		}

		// 统一重排为顺序数组：备份文件理论上就是数组，历史文件若写成对象也能按序处理
		$data['skills'] = array_values($data['skills']);

		return $data;
	}

	/**
	 * 预检或执行恢复
	 *
	 * @param array  $payload parse() 的返回值
	 * @param string $mode    merge（默认）/ overwrite；对 Skill 两者行为一致，
	 *                        仅改变同名 Skill 的版本，不删除备份外的条目
	 * @param bool   $dry_run true 只返回分类与逐条预览，不产生副作用
	 *
	 * 返回：{ dry_run, mode, note, summary, items }
	 * summary：{ new, updated, same, skipped, failed }；预检里 updated / failed 恒为 0，
	 * 同名 GitHub 计入 same（§6.5 的分类口径），执行阶段则记为 updated。
	 */
	public function restore(array $payload, string $mode = self::MODE_MERGE, bool $dry_run = false): array
	{
		if (!in_array($mode, [self::MODE_MERGE, self::MODE_OVERWRITE], true)) {
			throw new ValidationException('恢复失败：mode 只能是 merge 或 overwrite', 400);
		}

		$skills = $payload['skills'];

		// 预检：只读分类，直接返回，后面的安装 / 更新分支不会执行
		if ($dry_run) {
			return $this->preview($skills, $mode);
		}

		return $this->execute($skills, $mode);
	}

	/**
	 * 预检：按名称判断目标状态并给出逐条预览，不写库、不访问网络
	 *
	 * 分类口径：
	 *   - 名称不存在 → new（将按来源地址安装最新版本）；
	 *   - 同名 github → same（执行阶段会更新为最新版本）；
	 *   - 同名 upload → skipped（本地上传内容不在备份里，不覆盖）；
	 *   - 同名其它来源类型 → failed（无法判断能否安全更新）；
	 *   - 文件内同名重复 → 第一条后按 skipped。
	 *
	 * merge / overwrite 分类一致：overwrite 不删除备份外的 Skill（dev-spec §6.3），
	 * 因此不存在「全量重建」这种分类。
	 */
	private function preview(array $skills, string $mode): array
	{
		$counts = ['new' => 0, 'updated' => 0, 'same' => 0, 'skipped' => 0, 'failed' => 0];
		$items = [];
		$seen = [];

		foreach ($skills as $skill) {
			$name = trim((string)$skill['name']);

			if (isset($seen[$name])) {
				$counts['skipped']++;
				$items[] = ['name' => $name, 'status' => 'skipped', 'message' => '备份文件中同名条目重复，已忽略'];
				continue;
			}
			$seen[$name] = true;

			$existing = $this->repository->getSkillByName($name);

			if (!$existing) {
				$counts['new']++;
				$items[] = ['name' => $name, 'status' => 'new', 'message' => '将按来源地址安装最新版本'];
				continue;
			}

			$source_type = (string)($existing['source_type'] ?? '');

			if (SkillInstaller::SOURCE_TYPE_UPLOAD === $source_type) {
				$counts['skipped']++;
				$items[] = ['name' => $name, 'status' => 'skipped', 'message' => '本地上传的同名 Skill 不受影响，已跳过'];
				continue;
			}

			if (SkillInstaller::SOURCE_TYPE_GITHUB !== $source_type) {
				$counts['failed']++;
				$items[] = ['name' => $name, 'status' => 'failed', 'message' => '同名 Skill 来源类型不受支持'];
				continue;
			}

			$counts['same']++;
			$items[] = ['name' => $name, 'status' => 'same', 'message' => '同名 GitHub Skill，将更新为最新版本'];
		}

		return [
			'dry_run' => true,
			'mode' => $mode,
			'note' => self::BOUNDARY_NOTE,
			'summary' => $counts,
			'items' => $items,
		];
	}

	/**
	 * 执行恢复：逐条安装 / 更新，单条失败不中断整批
	 *
	 * 事务边界说明：这里无法用单个数据库事务包住整批——每条都要 clone/fetch 外部
	 * 仓库（耗时且不可回滚），SkillInstaller 内部也是「文件系统 + 单条写库」的原子
	 * 单元。因此失败隔离按条做：失败条目已由 SkillInstaller 自行清理半成品目录，
	 * 成功条目保留结果，最后汇总计数。
	 */
	private function execute(array $skills, string $mode): array
	{
		$counts = ['new' => 0, 'updated' => 0, 'same' => 0, 'skipped' => 0, 'failed' => 0];
		$items = [];
		$seen = [];

		foreach ($skills as $skill) {
			$name = trim((string)$skill['name']);
			$source_url = trim((string)$skill['source_url']);

			if (isset($seen[$name])) {
				$counts['skipped']++;
				$items[] = ['name' => $name, 'status' => 'skipped', 'message' => '备份文件中同名条目重复，已忽略'];
				continue;
			}
			$seen[$name] = true;

			try {
				$existing = $this->repository->getSkillByName($name);

				if ($existing) {
					$source_type = (string)($existing['source_type'] ?? '');

					if (SkillInstaller::SOURCE_TYPE_UPLOAD === $source_type) {
						// 本地上传的 Skill 内容不在备份里，覆盖会丢失用户数据，一律跳过
						$counts['skipped']++;
						$items[] = ['name' => $name, 'status' => 'skipped', 'message' => '本地上传的同名 Skill 不受影响，已跳过'];
						continue;
					}

					if (SkillInstaller::SOURCE_TYPE_GITHUB !== $source_type) {
						$counts['failed']++;
						$items[] = ['name' => $name, 'status' => 'failed', 'message' => '同名 Skill 来源类型不受支持'];
						continue;
					}

					// payload 行没有 id：先按名称取现有行（含 id / 目录名）再更新，
					// 直接传 payload 行会让 updateFromGithub 读到不存在的 id 与目录
					$this->installer->updateFromGithub($existing);
					$counts['updated']++;
					$items[] = ['name' => $name, 'status' => 'updated'];
					continue;
				}

				$installed = $this->installer->installFromGithub($source_url);
				$counts['new']++;

				$item = ['name' => $name, 'status' => 'new'];
				$installed_name = (string)($installed['name'] ?? '');
				// 子目录链接的 source_url 归一后只保留仓库地址，按 URL 解析出的名称
				// 可能与备份名不同；如实回显，避免用户以为装成了另一个 Skill
				if ($installed_name !== '' && $installed_name !== $name) {
					$item['message'] = '按来源地址安装为 ' . $installed_name;
				}
				$items[] = $item;
			} catch (Throwable $e) {
				// 单条失败（GitHub 不可达 / URL 非法 / 目录缺失等）不中断整批；
				// SkillInstaller 的 [SL-XXX-NNNN] 原文透传，便于定位
				$counts['failed']++;
				$items[] = ['name' => $name, 'status' => 'failed', 'message' => $e->getMessage()];
			}
		}

		return [
			'dry_run' => false,
			'mode' => $mode,
			'note' => self::BOUNDARY_NOTE,
			'summary' => $counts,
			'items' => $items,
		];
	}
}

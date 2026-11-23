<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Utils\BackupPayload;
use Utils\SkillInstaller;
use function Framework\data;

class BackupSkillsGetController implements ControllerInterface
{
	/**
	 * GET /api/backup/skills
	 *
	 * Skill 模块 JSON 备份（refinements.md §4.5 / dev-spec §6.3）：
	 * { module: 'skills', version, exported_at, skills: [...], skipped: { upload } }
	 *
	 * 数据范围：只导出 source_type='github' 且有 source_url 的 Skill，字段为
	 * name / source_url / description / fingerprint / installed_at。本地上传的 Skill
	 * 内容不落 Hub 数据层（zip 解压在 storage/skills/），单文件备份无法还原，因此
	 * 只计入 skipped.upload 让用户知道被跳过了多少条，不导出任何内容（dev-spec §1）。
	 *
	 * 不导出 Skill 标签：恢复流程不重建标签（dev-spec §6.3），导出 tags 只会让
	 * 恢复端多一份「导出了但不恢复」的歧义数据。
	 *
	 * 响应形态：data() 直接返回备份对象——响应体本身就是备份文件内容；出错仍走
	 * 框架统一 { success: false, message, error }。备份含用户 Skill 清单，响应显式
	 * no-store；端点走默认会话认证（GET 天然跳过 CSRF），不加入任何跳过名单。
	 */
	public function __invoke(array $input): ResponseInterface
	{
		BackupPayload::noStore();

		$repository = ServiceContainer::get(Repository::class);

		$skills = [];
		$skipped_upload = 0;

		// 复用列表接口同源的 getSkills()（返回行含 source_type / source_url）；
		// 它顺带查出的 tags 不在备份范围，忽略即可
		foreach ($repository->getSkills() as $row) {
			$source_type = (string)($row['source_type'] ?? '');
			$source_url = trim((string)($row['source_url'] ?? ''));

			// source_url 为空的 github 条目属于来源元数据丢失的历史脏数据，
			// 恢复端无法据 URL 重新拉取，混进备份只会逐条报错，按不可备份跳过
			if (SkillInstaller::SOURCE_TYPE_GITHUB !== $source_type || '' === $source_url) {
				// 只统计 upload 来源：skipped.upload 的语义是「被跳过的本地上传数」，
				// 把其它异常来源也算进来会让数值与文案不符
				if (SkillInstaller::SOURCE_TYPE_UPLOAD === $source_type) {
					$skipped_upload++;
				}
				continue;
			}

			$skills[] = [
				'name' => (string)$row['name'],
				'source_url' => $source_url,
				'description' => (string)($row['description'] ?? ''),
				'fingerprint' => (string)($row['fingerprint'] ?? ''),
				'installed_at' => $row['installed_at'] ?? null,
			];
		}

		// 下载头：直接访问端点时浏览器存成 super-link-skills-YYYYMMDD.json
		header('Content-Disposition: attachment; filename="' . BackupPayload::fileName('skills') . '"');

		return data(BackupPayload::build('skills', [
			'skills' => $skills,
			'skipped' => ['upload' => $skipped_upload],
		]));
	}
}

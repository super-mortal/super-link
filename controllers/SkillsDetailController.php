<?php

namespace Controllers;

use Config;
use Framework\ControllerInterface;
use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\success;

class SkillsDetailController implements ControllerInterface
{
	private const SKILL_FILE_NAME = 'SKILL.md';
	private const MAX_CONTENT_BYTES = 524288; // 512KB，防止超大 SKILL.md 打爆内存

	public function __invoke(array $input): ResponseInterface
	{
		$id = $this->parseId($input['id'] ?? null);

		$repository = ServiceContainer::get(Repository::class);
		$row = $repository->getSkill($id);

		if (!$row) {
			throw new NotFoundException('[SL-SKL-0002] Skill 不存在');
		}

		$skill = [
			'id' => (int)$row['id'],
			'name' => $row['name'],
			'description' => $row['description'],
			'source_type' => $row['source_type'],
			'source_url' => $row['source_url'],
			'fingerprint' => $row['fingerprint'],
			'installed_at' => $row['installed_at'],
			'updated_at' => $row['updated_at'],
			'tags' => array_values($repository->getSkillTags()[$id] ?? []),
		];

		$directory = $this->resolveSkillDirectory((string)$row['name']);
		$skill_file = $directory === null ? null : $this->findSkillFile($directory, (string)$row['name']);

		$content = '';

		if ($skill_file === null) {
			$skill['missing_skill_md'] = true;
		} else {
			$content = $this->readSkillContent($skill_file);
		}

		return success('获取 Skill 详情成功', [
			'skill' => $skill,
			'content' => $content,
			'files' => $directory === null ? [] : $this->listFiles($directory),
		]);
	}

	private function parseId(mixed $raw): int
	{
		if ((!is_string($raw) && !is_int($raw)) || !ctype_digit((string)$raw) || (int)$raw <= 0) {
			throw new ValidationException('[SL-SKL-0007] 缺少或非法的 Skill id 参数');
		}

		return (int)$raw;
	}

	/**
	 * 目录名只取自 DB 记录，不接受任何请求传入的路径片段。
	 */
	private function resolveSkillDirectory(string $name): ?string
	{
		$storage = realpath(Config::getSkillsStoragePath());

		if ($storage === false) {
			return null;
		}

		$directory = realpath(rtrim($storage, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $name);

		if ($directory === false || !is_dir($directory)) {
			return null;
		}

		if (!str_starts_with($directory, $storage . DIRECTORY_SEPARATOR)) {
			throw new ValidationException('[SL-SEC-0003] 目标路径越出 skills 存储目录，已拒绝访问');
		}

		return $directory;
	}

	/**
	 * 与 SkillInstaller 的定位顺序保持一致：根目录 -> skills/<name>/ -> 一级子目录。
	 */
	private function findSkillFile(string $directory, string $name): ?string
	{
		$candidates = [
			$directory . '/' . self::SKILL_FILE_NAME,
			$directory . '/skills/' . $name . '/' . self::SKILL_FILE_NAME,
		];

		foreach (glob($directory . '/skills/*/' . self::SKILL_FILE_NAME) ?: [] as $candidate) {
			$candidates[] = $candidate;
		}

		foreach (scandir($directory) ?: [] as $entry) {
			if ($entry === '.' || $entry === '..' || $entry === '.git') {
				continue;
			}

			$path = $directory . '/' . $entry;

			if (is_dir($path)) {
				$candidates[] = $path . '/' . self::SKILL_FILE_NAME;
			}
		}

		foreach ($candidates as $candidate) {
			$real_path = realpath($candidate);

			if ($real_path === false || !is_file($real_path)) {
				continue;
			}

			// 符号链接可能指向目录外，读取前再断言一次。
			if (!str_starts_with($real_path, $directory . DIRECTORY_SEPARATOR)) {
				throw new ValidationException('[SL-SEC-0003] 目标路径越出 skills 存储目录，已拒绝访问');
			}

			return $real_path;
		}

		return null;
	}

	private function readSkillContent(string $path): string
	{
		$content = file_get_contents($path, false, null, 0, self::MAX_CONTENT_BYTES);

		if ($content === false) {
			return '';
		}

		// json_encode 遇到非法 UTF-8 会整体失败，先清洗一遍。
		if (!mb_check_encoding($content, 'UTF-8')) {
			$content = mb_convert_encoding($content, 'UTF-8', 'UTF-8');
		}

		return $content;
	}

	/**
	 * 只展开 skill 根目录一层；子目录带递归文件数，跳过 .git。
	 */
	private function listFiles(string $directory): array
	{
		$files = [];

		foreach (scandir($directory) ?: [] as $entry) {
			if ($entry === '.' || $entry === '..' || $entry === '.git') {
				continue;
			}

			$path = $directory . '/' . $entry;

			if (is_dir($path)) {
				$files[] = [
					'name' => $entry . '/',
					'type' => 'dir',
					'count' => $this->countFiles($path),
				];
				continue;
			}

			$files[] = [
				'name' => $entry,
				'type' => 'file',
			];
		}

		usort($files, function (array $left, array $right): int {
			if ($left['type'] !== $right['type']) {
				return $left['type'] === 'dir' ? -1 : 1;
			}

			return strcasecmp($left['name'], $right['name']);
		});

		return $files;
	}

	private function countFiles(string $directory): int
	{
		$iterator = new \RecursiveIteratorIterator(
			new \RecursiveDirectoryIterator($directory, \FilesystemIterator::SKIP_DOTS)
		);

		$count = 0;

		foreach ($iterator as $item) {
			if ($item->isLink() || !$item->isFile()) {
				continue;
			}

			if (str_contains($item->getPathname(), DIRECTORY_SEPARATOR . '.git' . DIRECTORY_SEPARATOR)) {
				continue;
			}

			$count++;
		}

		return $count;
	}
}

<?php

namespace Utils;

use Config;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;
use Models\Repository;
use Throwable;

class SkillInstaller
{
	const SKILL_FILE_NAME = 'SKILL.md';
	const SOURCE_TYPE_GITHUB = 'github';
	const SOURCE_TYPE_UPLOAD = 'upload';
	const FINGERPRINT_LENGTH = 7;
	const MAX_UPLOAD_SIZE = 33554432; // 32MB，与 php.ini 的 upload_max_filesize 对齐
	const MAX_ENTRY_COUNT = 2000;
	const MAX_UNCOMPRESSED_SIZE = 268435456; // 256MB，防 zip bomb

	public function __construct(
		protected Repository $repository,
		protected GitHelper $git_helper = new GitHelper()
	) {
	}

	/**
	 * Install a skill from a public GitHub repository.
	 *
	 * @return array Skill object matching the GET /api/skills item shape.
	 */
	public function installFromGithub(string $url): array
	{
		[$clone_url, $name] = $this->normalizeGithubUrl($url);

		if ($this->repository->getSkillByName($name)) {
			throw new ValidationException('[SL-SKL-0001] 同名 Skill 已存在，请先删除后再安装');
		}

		$dest = rtrim(Config::getSkillsStoragePath(), '/') . '/' . $name;

		// DB UNIQUE covers rows only; a leftover directory must be rejected too.
		if (file_exists($dest)) {
			throw new ValidationException(sprintf('[SL-SKL-0001] 目标目录已存在：%s，请先清理', $name));
		}

		try {
			$this->git_helper->cloneDepth1($clone_url, $dest);
			$skill_file = $this->locateSkillFile($dest, $name);
			$frontmatter = SkillFrontmatter::parse((string)file_get_contents($skill_file));

			// The directory name wins; a mismatching frontmatter name is informational only.
			if (isset($frontmatter['name']) && $frontmatter['name'] !== $name) {
				error_log(sprintf(
					'[SkillInstaller] SKILL.md name "%s" 与目录名 "%s" 不一致，以目录名为准',
					$frontmatter['name'],
					$name
				));
			}

			$fingerprint = substr($this->git_helper->head($dest), 0, self::FINGERPRINT_LENGTH);

			$skill_id = (int)$this->repository->createSkill([
				'name' => $name,
				'description' => (string)($frontmatter['description'] ?? ''),
				'source_type' => self::SOURCE_TYPE_GITHUB,
				'source_url' => $clone_url,
				'fingerprint' => $fingerprint,
			]);
		} catch (ValidationException | DataWriteException $e) {
			$this->removeSkillDirectory($dest);
			throw $e;
		} catch (Throwable $e) {
			$this->removeSkillDirectory($dest);
			throw new DataWriteException('[SL-EXT-0001] Skill 安装失败：' . $e->getMessage(), 500, $e);
		}

		if ($skill_id <= 0) {
			$this->removeSkillDirectory($dest);
			throw new DataWriteException('[SL-EXT-0001] Skill 写入数据库失败');
		}

		$row = $this->repository->getSkill($skill_id);
		if (!$row) {
			$this->removeSkillDirectory($dest);
			throw new DataWriteException('[SL-EXT-0001] Skill 安装后读取失败');
		}

		return $this->formatSkill($row);
	}

	/**
	 * Remote HEAD prefix (7 chars) of an installed GitHub skill, used to detect updates.
	 */
	public function remoteFingerprint(string $name): string
	{
		$head = $this->git_helper->fetchHead($this->skillDirectoryPath($name));

		return substr($head, 0, self::FINGERPRINT_LENGTH);
	}

	/**
	 * Align an installed GitHub skill with its upstream and refresh its metadata.
	 *
	 * @param array $row Raw skills row.
	 *
	 * @return array Skill object matching the GET /api/skills item shape.
	 */
	public function updateFromGithub(array $row): array
	{
		$name = (string)$row['name'];
		$dest = $this->skillDirectoryPath($name);

		try {
			$head = $this->git_helper->fetchHead($dest);
			$this->git_helper->resetToFetched($dest);

			// 更新后 SKILL.md 的位置可能变化（仓库改布局），重新定位而不是复用安装时的路径。
			$skill_file = $this->locateSkillFile($dest, $name);
			$frontmatter = SkillFrontmatter::parse((string)file_get_contents($skill_file));
		} catch (Throwable $e) {
			throw new DataWriteException(sprintf(
				'[SL-SKL-0006] Skill 更新失败（%s）：%s',
				$name,
				$e->getMessage()
			), 500, $e);
		}

		$skill_id = (int)$row['id'];
		$description = (string)($frontmatter['description'] ?? $row['description'] ?? '');

		// description 缺失时保留原值：frontmatter 解析失败不该把已有描述清空（SL-SKL-0004）。
		$this->repository->updateSkillMeta($skill_id, $description, (string)($row['source_url'] ?? ''));
		$this->repository->updateSkillFingerprint($skill_id, substr($head, 0, self::FINGERPRINT_LENGTH));

		$updated = $this->repository->getSkill($skill_id);

		if (!$updated) {
			throw new DataWriteException('[SL-EXT-0001] Skill 更新后读取失败');
		}

		$skill = $this->formatSkill($updated);
		$skill['tags'] = $this->repository->getSkillTags()[$skill_id] ?? [];

		return $skill;
	}

	/**
	 * Install (or overwrite) a skill from an uploaded zip archive.
	 *
	 * Uploads are treated as the authoritative copy: a same-named skill from a
	 * previous upload is replaced in place, while a GitHub-sourced one is kept
	 * (re-installing from a zip would silently detach it from its upstream).
	 *
	 * @param array $file One entry of $_FILES (name/tmp_name/error/size).
	 *
	 * @return array Skill object matching the GET /api/skills item shape.
	 */
	public function installFromUpload(array $file): array
	{
		$this->assertUploadedFile($file);

		$tmp_path = (string)$file['tmp_name'];
		$fallback_name = $this->sanitizeUploadName(pathinfo((string)$file['name'], PATHINFO_FILENAME));

		$zip = new \ZipArchive();
		$zip_open = false;
		$staging = '';
		$dest = '';
		$done = false;

		try {
			$zip_open = $zip->open($tmp_path) === true;
			if (!$zip_open) {
				throw new DataWriteException('[SL-IO-0003] 压缩包无法打开或已损坏');
			}

			if ($zip->numFiles > self::MAX_ENTRY_COUNT) {
				throw new ValidationException(sprintf(
					'[SL-SEC-0004] 压缩包条目数量超过 %d 个，已拒绝解压',
					self::MAX_ENTRY_COUNT
				));
			}

			$this->assertSafeEntries($zip);

			$storage = rtrim(Config::getSkillsStoragePath(), '/');
			$staging = $storage . '/.upload-' . bin2hex(random_bytes(6));
			if (!mkdir($staging, 0755, true) && !is_dir($staging)) {
				throw new DataWriteException('[SL-IO-0003] 解压临时目录创建失败');
			}

			if (!$zip->extractTo($staging)) {
				throw new DataWriteException('[SL-IO-0003] 压缩包解压失败');
			}

			$single_root = $this->detectSingleRoot($zip);
			$content_root = $single_root === null ? $staging : $staging . '/' . $single_root;

			// 单层根目录的包用目录名；否则用 SKILL.md 所在目录名；再退到 zip 文件名。
			$skill_file = $this->locateSkillFile($content_root, $fallback_name);
			$name_source = $single_root;
			// `skills/<name>/` 布局下，包根目录只是容器，真正的名字在内层目录上。
			if ($name_source === 'skills' && dirname($skill_file) !== $content_root) {
				$name_source = null;
			}
			$name = $this->sanitizeUploadName($name_source ?? $this->deriveUploadName($skill_file, $staging, $fallback_name));

			// 同名检查必须在删除任何目录之前完成，否则会把 GitHub 来源的目录当残留清掉。
			$existing = $this->repository->getSkillByName($name);
			if ($existing && $existing['source_type'] !== self::SOURCE_TYPE_UPLOAD) {
				throw new ValidationException('[SL-SKL-0001] 同名 Skill 来自 GitHub 安装，请先删除后再上传');
			}

			$dest = $storage . '/' . $name;

			// 覆盖只替换文件内容与元数据；标签是用户自己打的，与包内容无关，必须保留。
			$this->removeSkillDirectory($dest);

			// 目标目录只放 skill 本体：SKILL.md 在内层时移动内层目录，避免留下 `skills/x/skills/x` 套娃。
			$move_source = $content_root;
			if ($single_root === null && dirname($skill_file) !== $staging) {
				$move_source = dirname($skill_file);
			}

			if (!@rename($move_source, $dest)) {
				throw new DataWriteException('[SL-IO-0003] Skill 目录写入失败');
			}

			// 解压后按最终位置再定位一次，顺带确认 SKILL.md 没有落在目录之外。
			$skill_file = $this->locateSkillFile($dest, $name);
			$content = (string)file_get_contents($skill_file);
			$frontmatter = SkillFrontmatter::parse($content);
			$fingerprint = substr(hash('sha256', $content), 0, self::FINGERPRINT_LENGTH);
			$description = (string)($frontmatter['description'] ?? '');

			if ($existing) {
				$skill_id = (int)$existing['id'];
				$this->repository->updateSkillMeta($skill_id, $description, '');
				$this->repository->updateSkillFingerprint($skill_id, $fingerprint);
			} else {
				$skill_id = (int)$this->repository->createSkill([
					'name' => $name,
					'description' => $description,
					'source_type' => self::SOURCE_TYPE_UPLOAD,
					'source_url' => '',
					'fingerprint' => $fingerprint,
				]);
			}

			if ($skill_id <= 0) {
				throw new DataWriteException('[SL-EXT-0001] Skill 写入数据库失败');
			}

			$row = $this->repository->getSkill($skill_id);
			if (!$row) {
				throw new DataWriteException('[SL-EXT-0001] Skill 安装后读取失败');
			}

			$done = true;

			$skill = $this->formatSkill($row);
			if ($existing) {
				// 覆盖后标签仍在库里，响应里也要如实返回，否则前端会误判为已清空。
				$skill['tags'] = $this->repository->getSkillTags()[$skill_id] ?? [];
			}

			return $skill;
		} catch (ValidationException | DataWriteException $e) {
			throw $e;
		} catch (Throwable $e) {
			throw new DataWriteException('[SL-EXT-0001] Skill 上传安装失败：' . $e->getMessage(), 500, $e);
		} finally {
			if ($zip_open) {
				$zip->close();
			}
			// 无论成败，临时目录都必须清掉；失败的半成品目标目录同样不留痕。
			if ($staging !== '' && is_dir($staging)) {
				$this->removeSkillDirectory($staging);
			}
			if (!$done && $dest !== '') {
				$this->removeSkillDirectory($dest);
			}
		}
	}

	/**
	 * Normalize the supported URL forms to [clone url, skill name].
	 *
	 * Accepted: `owner/repo`, `https://github.com/owner/repo`,
	 * `https://github.com/owner/repo/tree/<branch>/<sub-path>`.
	 * Everything else (ssh, http, other hosts) is rejected with SL-SEC-0002.
	 *
	 * @return array{0: string, 1: string}
	 */
	private function normalizeGithubUrl(string $url): array
	{
		$url = trim($url);

		if (preg_match('#^([A-Za-z0-9][A-Za-z0-9._-]*)/([A-Za-z0-9][A-Za-z0-9._-]*)$#', $url, $matches) === 1) {
			$repo = $this->stripGitSuffix($matches[2]);
			return [
				sprintf('https://github.com/%s/%s', $matches[1], $repo),
				$this->sanitizeName($repo),
			];
		}

		$parts = parse_url($url);
		if (!is_array($parts)) {
			throw new ValidationException('[SL-SEC-0002] 仅支持 https://github.com 仓库地址或 owner/repo 简写');
		}

		$scheme = strtolower($parts['scheme'] ?? '');
		$host = strtolower($parts['host'] ?? '');
		$has_credentials = isset($parts['user']) || isset($parts['pass']) || isset($parts['port']);

		if ($scheme !== 'https' || $host !== 'github.com' || $has_credentials) {
			throw new ValidationException('[SL-SEC-0002] 仅支持 https://github.com 仓库地址或 owner/repo 简写');
		}

		$segments = array_values(array_filter(
			explode('/', $parts['path'] ?? ''),
			fn(string $segment) => $segment !== ''
		));

		if (count($segments) < 2) {
			throw new ValidationException('[SL-SEC-0002] 无法从链接中解析出 owner/repo');
		}

		$owner = $segments[0];
		$repo = $this->stripGitSuffix($segments[1]);
		// Sub-directory links (`/tree/<branch>/<sub-path>`) use the last segment as the name.
		$name = count($segments) > 2 ? $segments[count($segments) - 1] : $repo;

		return [
			sprintf('https://github.com/%s/%s', $owner, $repo),
			$this->sanitizeName($name),
		];
	}

	private function stripGitSuffix(string $value): string
	{
		return preg_replace('/\.git$/i', '', $value) ?? $value;
	}

	private function sanitizeName(string $name): string
	{
		$name = trim($name);

		if (preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]*$/', $name) !== 1) {
			throw new ValidationException('[SL-SEC-0002] Skill 名称非法：' . $name);
		}

		return $name;
	}

	/**
	 * Locate SKILL.md: repository root -> ./skills/<name>/ -> any first level sub-directory.
	 */
	private function locateSkillFile(string $dest, string $name): string
	{
		$candidates = [
			$dest . '/' . self::SKILL_FILE_NAME,
			$dest . '/skills/' . $name . '/' . self::SKILL_FILE_NAME,
		];

		// Uploads may keep the real directory name inside `skills/`, so the name guess cannot be trusted.
		foreach (glob($dest . '/skills/*/' . self::SKILL_FILE_NAME) ?: [] as $candidate) {
			$candidates[] = $candidate;
		}

		foreach (scandir($dest) ?: [] as $entry) {
			if ($entry === '.' || $entry === '..' || $entry === '.git') {
				continue;
			}
			$path = $dest . '/' . $entry;
			if (is_dir($path)) {
				$candidates[] = $path . '/' . self::SKILL_FILE_NAME;
			}
		}

		$real_dest = realpath($dest);

		foreach ($candidates as $candidate) {
			$real_path = realpath($candidate);
			if ($real_path === false || !is_file($real_path) || $real_dest === false) {
				continue;
			}
			// A symlinked SKILL.md must not point outside the installed directory.
			if (!str_starts_with($real_path, $real_dest . DIRECTORY_SEPARATOR)) {
				continue;
			}
			return $real_path;
		}

		throw new ValidationException(sprintf(
			'[SL-SKL-0003] 未找到 SKILL.md（已检查仓库根目录、skills/%s/ 与一级子目录）',
			$name
		));
	}

	private function formatSkill(array $row): array
	{
		return [
			'id' => (int)$row['id'],
			'name' => $row['name'],
			'description' => $row['description'],
			'source_type' => $row['source_type'],
			'source_url' => $row['source_url'],
			'fingerprint' => $row['fingerprint'],
			'installed_at' => $row['installed_at'],
			'updated_at' => $row['updated_at'],
			'tags' => [],
		];
	}

	/**
	 * Server side checks: PHP's own upload limits only cover transport errors.
	 */
	private function assertUploadedFile(array $file): void
	{
		$error = (int)($file['error'] ?? UPLOAD_ERR_NO_FILE);

		if ($error !== UPLOAD_ERR_OK) {
			// 超过 upload_max_filesize / post_max_size 时 PHP 直接给这两个错误码。
			if ($error === UPLOAD_ERR_INI_SIZE || $error === UPLOAD_ERR_FORM_SIZE) {
				throw new ValidationException('[SL-IO-0006] 上传文件超过 32MB', 413);
			}
			throw new ValidationException('[SL-IO-0001] 上传失败或未选择文件');
		}

		$name = (string)($file['name'] ?? '');
		if (strtolower(pathinfo($name, PATHINFO_EXTENSION)) !== 'zip') {
			throw new ValidationException('[SL-IO-0002] 仅支持 .zip 压缩包');
		}

		$tmp_path = (string)($file['tmp_name'] ?? '');
		if ($tmp_path === '' || !is_file($tmp_path) || !is_readable($tmp_path)) {
			throw new ValidationException('[SL-IO-0001] 上传文件不可读');
		}

		$size = (int)($file['size'] ?? 0);
		if ($size <= 0) {
			$size = (int)filesize($tmp_path);
		}
		if ($size > self::MAX_UPLOAD_SIZE) {
			throw new ValidationException('[SL-IO-0006] 上传文件超过 32MB', 413);
		}
	}

	/**
	 * Reject zip-slip / zip-bomb payloads before a single byte is extracted.
	 */
	private function assertSafeEntries(\ZipArchive $zip): void
	{
		$total = 0;

		for ($index = 0; $index < $zip->numFiles; $index++) {
			$stat = $zip->statIndex($index);
			if ($stat === false) {
				throw new ValidationException('[SL-SEC-0001] 压缩包条目无法读取');
			}

			$this->assertSafeEntryName((string)$stat['name']);

			$total += (int)($stat['size'] ?? 0);
			if ($total > self::MAX_UNCOMPRESSED_SIZE) {
				throw new ValidationException('[SL-SEC-0004] 解压后总体积超过 256MB，已拒绝解压');
			}
		}
	}

	private function assertSafeEntryName(string $name): void
	{
		// 条目名是唯一的逃逸入口：`../`、绝对路径、盘符、反斜杠都能写到目标目录之外。
		if ($name === '' || str_contains($name, "\0") || str_contains($name, '\\')) {
			throw new ValidationException(sprintf('[SL-SEC-0001] 压缩包含非法路径条目：%s', $name));
		}

		if (str_starts_with($name, '/')) {
			throw new ValidationException(sprintf('[SL-SEC-0001] 压缩包含绝对路径条目：%s', $name));
		}

		if (preg_match('/^[A-Za-z]:/', $name) === 1) {
			throw new ValidationException(sprintf('[SL-SEC-0001] 压缩包含盘符条目：%s', $name));
		}

		foreach (explode('/', $name) as $segment) {
			if ($segment === '..') {
				throw new ValidationException(sprintf('[SL-SEC-0001] 压缩包含上级目录条目：%s', $name));
			}
		}
	}

	/**
	 * Return the shared top level directory, or null when the archive is flat
	 * (top level files) or has more than one root.
	 */
	private function detectSingleRoot(\ZipArchive $zip): ?string
	{
		$root = null;

		for ($index = 0; $index < $zip->numFiles; $index++) {
			$raw = (string)$zip->getNameIndex($index);
			$is_dir_entry = str_ends_with($raw, '/');
			$name = rtrim($raw, '/');

			if ($name === '') {
				continue;
			}

			$segments = explode('/', $name);

			if (count($segments) === 1) {
				if (!$is_dir_entry) {
					return null;
				}
			}

			if ($root === null) {
				$root = $segments[0];
				continue;
			}

			if ($root !== $segments[0]) {
				return null;
			}
		}

		return $root;
	}

	private function deriveUploadName(string $skill_file, string $staging, string $fallback): string
	{
		$dir = dirname($skill_file);

		if ($dir !== '' && $dir !== rtrim($staging, '/')) {
			return basename($dir);
		}

		return $fallback;
	}

	private function sanitizeUploadName(string $name): string
	{
		$name = preg_replace('/[^A-Za-z0-9._-]+/', '-', trim($name)) ?? '';
		// 去掉首尾的 `.` 与 `-`，顺带消灭 `..` 这类目录名。
		$name = trim(substr($name, 0, 64), '-.');

		return $name === '' ? 'skill-' . time() : $name;
	}

	/**
	 * Build the on-disk path of an installed skill.
	 *
	 * The name comes from the DB row only, but it still has to be rejected when
	 * it carries path separators: a corrupted row must not reach outside storage.
	 */
	private function skillDirectoryPath(string $name): string
	{
		if ($name === '' || $name === '.' || $name === '..' || str_contains($name, '/') || str_contains($name, '\\')) {
			throw new ValidationException('[SL-SEC-0003] 目标路径越出 skills 存储目录，已拒绝操作');
		}

		$dest = rtrim(Config::getSkillsStoragePath(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $name;

		if (!is_dir($dest)) {
			throw new NotFoundException('[SL-SKL-0002] Skill 目录不存在，请重新安装');
		}

		return $dest;
	}

	/**
	 * realpath assertion: nothing outside storage/skills/ may be deleted.
	 */
	private function assertWithinStorage(string $path): string
	{
		$root = realpath(Config::getSkillsStoragePath());
		$target = realpath($path);

		if ($root === false || $target === false || !str_starts_with($target, $root . DIRECTORY_SEPARATOR)) {
			throw new ValidationException('[SL-SEC-0003] 目标路径越出 skills 存储目录，已拒绝操作');
		}

		return $target;
	}

	/**
	 * Recursively remove a directory inside storage/skills/.
	 */
	public function removeSkillDirectory(string $path): void
	{
		if (!is_dir($path)) {
			return;
		}

		$target = $this->assertWithinStorage($path);

		$iterator = new \RecursiveIteratorIterator(
			new \RecursiveDirectoryIterator($target, \FilesystemIterator::SKIP_DOTS),
			\RecursiveIteratorIterator::CHILD_FIRST
		);

		foreach ($iterator as $item) {
			// Unlink symlinks instead of following them.
			if ($item->isLink() || $item->isFile()) {
				@unlink($item->getPathname());
				continue;
			}
			@rmdir($item->getPathname());
		}

		@rmdir($target);
	}
}

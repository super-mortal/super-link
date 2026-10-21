<?php

namespace Utils;

use Config;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\NotFoundException;
use Framework\Exceptions\ValidationException;
use Models\Repository;
use Throwable;
use ZipArchive;

class SkillExporter
{
	/** 递归任意层级都排除，`.git` 是更新检测的内部数据，不该出现在分发包里 */
	const EXCLUDED_DIRECTORIES = ['.git'];

	/** 系统级垃圾文件，跨平台导出时一并剔除 */
	const EXCLUDED_FILES = ['.DS_Store', 'Thumbs.db'];

	public function __construct(protected Repository $repository)
	{
	}

	/**
	 * 把 skill 目录打包成临时 zip。
	 *
	 * zip 内根目录固定为 `<name>/`：与上传安装「单层根目录」的识别规则对齐，
	 * 导出的包重新上传即可直接安装，不会多套一层目录。
	 *
	 * @return string 临时 zip 的绝对路径，调用方负责输出后清理。
	 */
	public function export(int $skill_id): string
	{
		$row = $this->repository->getSkill($skill_id);

		if (!$row) {
			throw new NotFoundException('[SL-SKL-0002] Skill 不存在');
		}

		$name = (string)$row['name'];
		$directory = $this->skillDirectoryPath($name);

		$zip_path = $this->temporaryPath();

		try {
			$this->writeArchive($directory, $zip_path, $name);
		} catch (Throwable $e) {
			$this->removeTemporaryFile($zip_path);

			if ($e instanceof DataWriteException) {
				throw $e;
			}

			throw new DataWriteException('[SL-IO-0005] 导出压缩包创建失败：' . $e->getMessage(), 500, $e);
		}

		return $zip_path;
	}

	/**
	 * 逐条目写入 zip；遇到 .git / 系统垃圾文件跳过，符号链接不跟随（可能指向目录之外）。
	 */
	private function writeArchive(string $directory, string $zip_path, string $name): void
	{
		$zip = new ZipArchive();

		if ($zip->open($zip_path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
			throw new DataWriteException('[SL-IO-0005] 导出压缩包创建失败');
		}

		try {
			if (!$zip->addEmptyDir($name)) {
				throw new DataWriteException('[SL-IO-0005] 导出压缩包根目录条目创建失败');
			}

			foreach ($this->collectEntries($directory, $name) as [$entry_name, $entry_path, $is_dir]) {
				if ($is_dir) {
					$zip->addEmptyDir($entry_name);
					continue;
				}

				if (!$zip->addFile($entry_path, $entry_name)) {
					throw new DataWriteException(sprintf('[SL-IO-0005] 导出压缩包写入失败：%s', $entry_name));
				}
			}

			if (!$zip->close()) {
				throw new DataWriteException('[SL-IO-0005] 导出压缩包写入失败');
			}
		} catch (Throwable $e) {
			// 失败的 zip 是半成品，必须关掉句柄再删文件，否则临时目录会留垃圾。
			@$zip->close();
			throw $e;
		}
	}

	/**
	 * @return array<int, array{0: string, 1: string, 2: bool}> [zip 内条目名, 磁盘绝对路径, 是否目录]
	 */
	private function collectEntries(string $directory, string $name): array
	{
		$iterator = new \RecursiveIteratorIterator(
			new \RecursiveCallbackFilterIterator(
				new \RecursiveDirectoryIterator($directory, \FilesystemIterator::SKIP_DOTS),
				function (\SplFileInfo $current): bool {
					if ($current->isLink()) {
						return false;
					}

					return !$this->isExcluded($current->getFilename(), $current->isDir());
				}
			),
			\RecursiveIteratorIterator::SELF_FIRST
		);

		$entries = [];
		$prefix_length = strlen($directory) + 1;

		foreach ($iterator as $file) {
			$relative = substr($file->getPathname(), $prefix_length);

			// 条目名不能带上级路径段：导出包是唯一会被再次上传解压的产物，等于二次入口。
			if ($relative === '' || in_array('..', explode(DIRECTORY_SEPARATOR, $relative), true)) {
				throw new ValidationException('[SL-SEC-0003] 目标路径越出 skills 存储目录，已拒绝操作');
			}

			$entries[] = [$name . '/' . $relative, $file->getPathname(), $file->isDir()];
		}

		return $entries;
	}

	private function isExcluded(string $file_name, bool $is_dir): bool
	{
		if ($is_dir) {
			return in_array($file_name, self::EXCLUDED_DIRECTORIES, true);
		}

		return in_array($file_name, self::EXCLUDED_FILES, true) || $file_name === '.git';
	}

	/**
	 * 目录名只取自 DB 记录，不接受请求传入的路径片段；realpath 再确认一次没有越界。
	 */
	private function skillDirectoryPath(string $name): string
	{
		if ($name === '' || $name === '.' || $name === '..' || str_contains($name, '/') || str_contains($name, '\\')) {
			throw new ValidationException('[SL-SEC-0003] 目标路径越出 skills 存储目录，已拒绝操作');
		}

		$storage = realpath(Config::getSkillsStoragePath());

		if ($storage === false) {
			throw new DataWriteException('[SL-IO-0005] skills 存储目录不可用，导出失败');
		}

		$directory = realpath(rtrim($storage, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $name);

		if ($directory === false || !is_dir($directory)) {
			throw new NotFoundException('[SL-SKL-0002] Skill 目录不存在，请重新安装');
		}

		if (!str_starts_with($directory, $storage . DIRECTORY_SEPARATOR)) {
			throw new ValidationException('[SL-SEC-0003] 目标路径越出 skills 存储目录，已拒绝操作');
		}

		return $directory;
	}

	/**
	 * 临时文件放在系统临时目录：不落在 storage/ 下，避免被 skill 目录遍历当成残留。
	 */
	private function temporaryPath(): string
	{
		return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR
			. 'skill-export-' . bin2hex(random_bytes(8)) . '.zip';
	}

	private function removeTemporaryFile(string $path): void
	{
		if ($path !== '' && is_file($path)) {
			@unlink($path);
		}
	}
}

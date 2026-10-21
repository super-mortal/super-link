<?php

namespace Framework\Responses;

use RuntimeException;

/**
 * 把磁盘上的临时文件作为附件下发；与 MediaResponse 的区别是流式读取而非整块读入内存，
 * 且输出后删除源文件（导出 zip 这类一次性产物）。
 */
class FileResponse implements ResponseInterface
{
	public function __construct(protected string $file_path, protected string $download_name)
	{
	}

	public function yield(): void
	{
		if (!is_file($this->file_path) || !is_readable($this->file_path)) {
			throw new RuntimeException('File response source is not readable.');
		}

		$size = filesize($this->file_path);

		http_response_code(200);
		header('Content-Type: application/zip');
		header('Content-Disposition: attachment; filename="' . $this->sanitizeFileName($this->download_name) . '"');
		header('Content-Length: ' . (false === $size ? 0 : $size));
		header('Cache-Control: no-cache, no-store, must-revalidate');
		header_remove('Pragma');
		header_remove('Expires');

		readfile($this->file_path);

		// 临时文件的生命周期就到这次响应为止，下载是否中断都不该留下残留。
		@unlink($this->file_path);
	}

	/**
	 * 文件名最终会拼进 header，必须掐掉能破坏 header 的字符。
	 */
	private function sanitizeFileName(string $name): string
	{
		$name = str_replace(["\r", "\n", '"', '\\'], '', $name);

		return $name === '' ? 'download.zip' : $name;
	}
}

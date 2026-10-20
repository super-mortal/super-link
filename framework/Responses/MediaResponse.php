<?php

namespace Framework\Responses;

class MediaResponse implements ResponseInterface
{
	public function __construct(protected string $contents, protected int $cache_minutes)
	{
	}

	public function yield(): void
	{
		$contents = $this->contents;

		$finfo = new \finfo(FILEINFO_MIME_TYPE);
		$mime = $finfo->buffer($contents);

		http_response_code(200);
		header("Content-Type: {$mime}");
		header("Content-Length: " . strlen($contents));

		// Set caching headers
		if ($this->cache_minutes > 0) {
			$cache_seconds = $this->cache_minutes * 60;
			header("Cache-Control: public, max-age={$cache_seconds}, immutable");
		} else {
			header("Cache-Control: no-cache, no-store, must-revalidate");
		}
		// Remove headers that might interfere with caching set with Cache-Control
		header_remove('Pragma');
		header_remove('Expires');

		echo $contents;
	}
}
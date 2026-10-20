<?php

namespace Framework\Responses;

use RuntimeException;

class PageResponse implements ResponseInterface
{
	protected array $layouts = [];

	public function __construct(protected string $page_name, protected array $data, protected int $code)
	{
	}

	public function layout(string $layout_name, array $data = []): self
	{
		$this->layouts[] = [$layout_name, $data];
		return $this;
	}

	public function yield(): void
	{
		if (empty($this->layouts)) {
			throw new RuntimeException('No layout defined for page.');
		}

		$content = $this->viewOutput("/views/pages/{$this->page_name}.php", $this->data);

		foreach ($this->layouts as [$layout_name, $data]) {
			$content = $this->viewOutput("/views/layouts/{$layout_name}.php", array_merge($data, compact('content')));
		}

		http_response_code($this->code);
		echo $content;
	}

	protected function viewOutput(string $view_path, array $data = []): string
	{
		$view_path = ROOT_DIR . $view_path;
		if (!file_exists($view_path)) {
			throw new RuntimeException("View file not found: {$view_path}");
		}

		extract($data);

		ob_start();
		require $view_path;
		return ob_get_clean();
	}
}
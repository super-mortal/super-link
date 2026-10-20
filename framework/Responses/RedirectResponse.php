<?php

namespace Framework\Responses;

use RuntimeException;

class RedirectResponse implements ResponseInterface
{
	public function __construct(protected string $location, protected int $code)
	{
	}

	public function yield(): void
	{
		if (headers_sent()) {
			throw new RuntimeException('Headers already sent, cannot redirect.');
		}

		header('Location: ' . $this->location, true, $this->code);
		exit();
	}
}
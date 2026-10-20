<?php

namespace Framework\Middlewares;

abstract class MiddlewareAbstract
{
	public function __construct(protected ?MiddlewareAbstract $next, protected string $path, protected string $method, protected string $controller_class)
	{
	}

	abstract public function handle();
}
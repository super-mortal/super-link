<?php

namespace Framework;

use RuntimeException;

class ServiceContainer
{
	protected static $bindings = [];
	protected static $instances = [];

	public static function bind($abstract, $init_callable): void
	{
		self::$bindings[$abstract] = $init_callable;
	}

	public static function get($abstract)
	{
		if (isset(self::$instances[$abstract])) {
			return self::$instances[$abstract];
		}

		if (!isset(self::$bindings[$abstract])) {
			throw new RuntimeException("No binding found for {$abstract}");
		}

		$init_callable = self::$bindings[$abstract];
		$instance = $init_callable();

		if (!$instance instanceof $abstract) {
			throw new RuntimeException("Binding is not instance of {$abstract}");
		}

		self::$instances[$abstract] = $instance;

		return $instance;
	}
}

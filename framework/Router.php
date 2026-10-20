<?php

namespace Framework;

use Framework\Exceptions\NotFoundException;

class Router
{
	protected $routes;

	public function __construct(array $routes)
	{
		$this->routes = flattenRoutesArray($routes);
	}

	public function match_controller(string $path, string $method): string
	{
		$route_id = $path . '/' . $method;
		if (!isset($this->routes[$route_id])) {
			throw new NotFoundException("Route $method $path not found.");
		}

		return $this->routes[$route_id];
	}

	public function build_url(string $controller_class, array $params = []): string
	{
		$route_id = array_search($controller_class, $this->routes);
		if ($route_id === false) {
			throw new NotFoundException("No route found for controller $controller_class.");
		}

		$url = preg_replace('#\/([^/]+)$#', '', $route_id);

		if (!empty($params)) {
			$url .= '?' . http_build_query($params);
		}

		return $url;
	}
}



<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use function Framework\data;

class TagsController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$tags = $repository->getTags();

		return data($tags);
	}
}
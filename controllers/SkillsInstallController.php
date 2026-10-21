<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Respect\Validation\Validator;
use Utils\SkillInstaller;
use function Framework\success;

class SkillsInstallController implements ControllerInterface
{
	public function validateInput(): Validator
	{
		return Validator::key('url', Validator::stringType()->notEmpty()->setName('URL'));
	}

	public function __invoke(array $input): ResponseInterface
	{
		$repository = ServiceContainer::get(Repository::class);

		$installer = new SkillInstaller($repository);
		$skill = $installer->installFromGithub((string)$input['url']);

		return success('Skill 安装成功', [
			'skill' => $skill,
		]);
	}
}

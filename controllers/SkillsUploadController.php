<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Exceptions\DataWriteException;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Throwable;
use Utils\SkillInstaller;
use function Framework\success;

class SkillsUploadController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		// Application::getInput() merges $_FILES for multipart requests.
		$file = $input['file'] ?? null;

		if (!is_array($file)) {
			throw new ValidationException('[SL-IO-0001] 上传失败或未选择文件');
		}

		try {
			$installer = new SkillInstaller(ServiceContainer::get(Repository::class));
			$skill = $installer->installFromUpload($file);
		} catch (ValidationException | DataWriteException $e) {
			throw $e;
		} catch (Throwable $e) {
			throw new DataWriteException('[SL-EXT-0001] Skill 上传安装失败：' . $e->getMessage(), 500, $e);
		}

		return success('Skill 上传成功', [
			'skill' => $skill,
		]);
	}
}

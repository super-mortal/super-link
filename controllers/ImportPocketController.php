<?php

namespace Controllers;

use Exception;
use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Models\TagCreator;
use Utils\PocketImporter;
use ZipArchive;
use function Framework\data;

class ImportPocketController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		// Check if file was uploaded
		if (!isset($input['pocket-zip']) || $input['pocket-zip']['error'] !== UPLOAD_ERR_OK) {
			throw new ValidationException('No file uploaded or upload error');
		}

		$uploaded_file = $input['pocket-zip'];

		// Check if the file is a ZIP
		if ($uploaded_file['type'] !== 'application/zip' && $uploaded_file['type'] !== 'application/x-zip-compressed') {
			throw new ValidationException('Uploaded file is not a ZIP archive');
		}

		// Create a temporary directory
		$temp_dir = sys_get_temp_dir() . '/pocket_import_' . uniqid('', false);
		if (!mkdir($temp_dir, 0777, true) && !is_dir($temp_dir)) {
			throw new ValidationException('Uploaded file is not a ZIP archive');
		}
		try {
			// Extract the ZIP file
			$zip = new ZipArchive();
			if ($zip->open($uploaded_file['tmp_name']) !== true) {
				return data([
					'success' => false,
					'message' => 'Failed to open ZIP archive'
				], 400);
			}

			$zip->extractTo($temp_dir);
			$zip->close();

			// Process the extracted files
			$importer = new PocketImporter(
				ServiceContainer::get(Repository::class),
				ServiceContainer::get(TagCreator::class)
			);
			$import_count = $importer->processFiles($temp_dir);

			// Clean up
			$this->removeDirectory($temp_dir);

			return data([
				'success' => true,
				'message' => $import_count . ' Pocket bookmarks imported successfully'
			], 200);
		} catch (Exception $e) {
			// Clean up on error
			$this->removeDirectory($temp_dir);

			return data([
				'success' => false,
				'message' => 'Error importing bookmarks: ' . $e->getMessage()
			], 500);
		}
	}

	private function removeDirectory(string $dir)
	{
		if (!is_dir($dir)) {
			return;
		}
		$objects = scandir($dir);
		foreach ($objects as $object) {
			if ($object === '.' || $object === '..') {
				continue;
			}
			$object_path = $dir . '/' . $object;
			if (is_dir($object_path)) {
				$this->removeDirectory($object_path);
			} else {
				unlink($object_path);
			}
		}
		rmdir($dir);
	}
}

<?php

namespace Controllers;

use Exception;
use Framework\ControllerInterface;
use Framework\Exceptions\ValidationException;
use Framework\Responses\ResponseInterface;
use Framework\ServiceContainer;
use Models\Repository;
use Models\TagCreator;
use Utils\BookmarkImporter;
use function Framework\success;

class ImportBookmarksController implements ControllerInterface
{
	public function __invoke(array $input): ResponseInterface
	{
		try {
			if (!isset($_POST['import-source-name']) || !in_array($_POST['import-source-name'], ['browser', 'Raindrop.io'])) {
				throw new ValidationException('Invalid import source');
			}
			$import_source = $_POST['import-source-name'];

			$file_input_name = 'bookmark-file-html';

			if (!isset($_FILES[$file_input_name]) || $_FILES[$file_input_name]['error'] !== UPLOAD_ERR_OK) {
				throw new ValidationException('No file uploaded or upload error');
			}

			$uploaded_file = $_FILES[$file_input_name];

			// Check if the file is a HTML
			if ($uploaded_file['type'] !== 'text/html') {
				throw new ValidationException('Uploaded file is not an HTML');
			}

			$file_content = file_get_contents($uploaded_file['tmp_name']);
			if ($file_content === false) {
				throw new ValidationException('Could not read the uploaded file');
			}

			$importer = new BookmarkImporter(
				ServiceContainer::get(Repository::class),
				ServiceContainer::get(TagCreator::class),
				$import_source
			);

			$skipped_count = 0;
			$import_count = $importer->processHTML($file_content, $skipped_count);

			if ($import_count === 0) {
				throw new ValidationException('No bookmarks found in the uploaded file');
			}

			return success("{$import_count} bookmarks imported successfully, {$skipped_count} bookmarks skipped.");

		} catch (Exception $e) {

			throw new Exception(
				'Error importing bookmarks: ' . $e->getMessage(),
				$e->getCode()
			);
		}
	}
}

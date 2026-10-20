<?php

namespace Controllers;

use Framework\ControllerInterface;
use Framework\Responses\ResponseInterface;
use Respect\Validation\Validator;
use Utils\DOMParser;
use function Framework\success;
use function Utils\fetchPageHTML;

class UrlMetadataController implements ControllerInterface
{
	public function validateInput(): Validator
	{
		return Validator::key('url', Validator::url()->setName('URL'));
	}

	public function __invoke(array $input): ResponseInterface
	{
		$url = $input['url'];

		$html = fetchPageHTML($url);

		$parser = new DOMParser($html);

		return success(
			'Metadata fetched successfully',
			[
				'title' => $parser->extractTitle() ?? parse_url($url, PHP_URL_HOST),
				'description' => $parser->extractDescription() ?? '',
				'url' => $url
			]
		);
	}
}

<?php

namespace Framework\Exceptions;

use Exception;

class ValidationException extends Exception
{
	protected $message = 'Validation failed.';
	protected $code = 422;
}

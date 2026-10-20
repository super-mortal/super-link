<?php

namespace Framework\Exceptions;

use Exception;

class NotFoundException extends Exception
{
	protected $message = 'The requested resource was not found.';
	protected $code = 404;
}

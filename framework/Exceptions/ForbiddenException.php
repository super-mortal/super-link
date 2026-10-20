<?php

namespace Framework\Exceptions;

use Exception;

class ForbiddenException extends Exception
{
	protected $message = 'You do not have permission to access this resource.';
	protected $code = 403;
}

<?php

namespace Framework\Exceptions;

use Exception;

class UnauthorizedException extends Exception
{
	protected $message = 'Unauthorized access. Please log in to continue.';
	protected $code = 401;
}

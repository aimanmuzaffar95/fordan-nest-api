import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface StandardErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  errors?: string | string[];
  timestamp: string;
  path: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: string | string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else {
        const typedResponse = exceptionResponse as {
          message?: string | string[];
          error?: string;
        };

        const exceptionMessage = typedResponse.message;
        if (Array.isArray(exceptionMessage)) {
          message = 'Validation failed';
          errors = exceptionMessage;
        } else if (typeof exceptionMessage === 'string') {
          message = exceptionMessage;
        }

        if (!errors && typedResponse.error) {
          errors = typedResponse.error;
        }
      }
    }

    const payload: StandardErrorResponse = {
      success: false,
      statusCode: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(payload);
  }
}

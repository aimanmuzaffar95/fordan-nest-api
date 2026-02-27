import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

interface StandardSuccessResponse<T> {
  success: true;
  statusCode: number;
  message: string;
  data: T;
  timestamp: string;
  path: string;
}

interface HttpResponseLike {
  statusCode: number;
}

interface HttpRequestLike {
  url: string;
}

function isStandardResponse<T>(
  data: unknown,
): data is StandardSuccessResponse<T> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'success' in data &&
    'statusCode' in data &&
    'message' in data &&
    'data' in data &&
    'timestamp' in data &&
    'path' in data
  );
}

@Injectable()
export class SuccessResponseInterceptor<T> implements NestInterceptor<
  T,
  StandardSuccessResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<StandardSuccessResponse<T>> {
    const httpContext = context.switchToHttp();
    const response = httpContext.getResponse<HttpResponseLike>();
    const request = httpContext.getRequest<HttpRequestLike>();

    return next.handle().pipe(
      map((data: T) => {
        if (isStandardResponse<T>(data)) {
          return data;
        }

        return {
          success: true,
          statusCode: response.statusCode,
          message: 'Request successful',
          data,
          timestamp: new Date().toISOString(),
          path: request.url,
        };
      }),
    );
  }
}

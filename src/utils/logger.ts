/**
 * Simple structured logging utility for Cloudflare Workers.
 *
 * Cloudflare Workers automatically captures console.log/warn/error output
 * and includes it in Workers Logs when observability is enabled.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    // Debug logs are suppressed by default - use for development only
    if (typeof process !== 'undefined' && process.env?.LOG_LEVEL === 'debug') {
      // eslint-disable-next-line no-console
      console.log(formatLog('debug', message, context));
    }
  },

  info(message: string, context?: LogContext): void {
    // eslint-disable-next-line no-console
    console.log(formatLog('info', message, context));
  },

  warn(message: string, context?: LogContext): void {
    console.warn(formatLog('warn', message, context));
  },

  error(message: string, context?: LogContext): void {
    console.error(formatLog('error', message, context));
  },
};

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function validate(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    const first = issues[0];
    const message = first ? `${first.path ? `${first.path}: ` : ''}${first.message}` : 'Invalid request.';
    throw new HttpError(400, message, issues);
  }
  return result.data;
}

export function clientIp(request) {
  return String(request.ip || request.socket?.remoteAddress || '').slice(0, 64);
}

export function toCsv(rows, columns) {
  const escape = (value) => {
    if (value === null || value === undefined) return '';
    let text = String(value);
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = columns.map((column) => escape(column.label)).join(',');
  const lines = rows.map((row) => columns.map((column) => escape(row[column.key])).join(','));
  return [header, ...lines].join('\r\n');
}

import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { query } from '../db/client.js';
import { parse } from '../lib/http.js';
import { issueSchema, suggestionSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { hasValidFileSignature, removeUploadedFile, uploadIssueAttachment } from '../services/file-upload.js';
import { forwardSupportIssue } from '../services/support-email.js';

export default function registerSupportRoutes(app) {
  app.post('/api/support/reports', uploadIssueAttachment, async (request, response) => {
    try {
      const session = await requireAuth(request, response);
      if (!session) return;
      if (!(await hasValidFileSignature(request.file))) {
        return response.status(400).json({ ok: false, message: 'The attachment content does not match its file type.' });
      }
      const input = parse(issueSchema, request, response);
      if (!input) return;

      const reportId = crypto.randomUUID();
      const attachmentData = request.file ? await readFile(request.file.path) : null;
      try {
        await query(
          'INSERT INTO issue_reports(id,user_id,topic,timing,description,attachment_name,attachment_uri,attachment_data,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [reportId, session.userId, input.topic, input.timing, input.description, request.file?.originalname || null, null, attachmentData, Date.now()],
        );
      } catch {
        return response.status(500).json({ ok: false, message: 'Your report could not be saved.' });
      }

      let forwarded = false;
      try {
        forwarded = await forwardSupportIssue({
          id: reportId,
          topic: input.topic,
          timing: input.timing,
          description: input.description,
          reporterEmail: session.email,
          attachmentName: request.file?.originalname,
          attachmentPath: request.file?.path,
        });
      } catch (error) {
        console.error(`[mail] support report forwarding failed: ${error?.code ?? error?.message}`);
      }
      response.status(201).json({
        ok: true,
        forwarded,
        message: forwarded
          ? 'Your report was saved and sent to the support team.'
          : 'Your report was saved. The support team will review it in the Admin Panel.',
      });
    } finally {
      // The attachment is stored in the database; the temporary upload is always removed.
      removeUploadedFile(request.file);
    }
  });

  app.post('/api/support/suggestions', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(suggestionSchema, request, response);
    if (!input) return;
    await query('INSERT INTO feature_suggestions(id,user_id,suggestion,created_at) VALUES($1,$2,$3,$4)', [crypto.randomUUID(), session.userId, input.suggestion, Date.now()]);
    response.status(201).json({ ok: true, message: 'Your suggestion was submitted successfully.' });
  });
}

import express from 'express';
import { randomUUID } from 'node:crypto';
import { auth as jwtAuth, requiredScopes } from 'express-oauth2-jwt-bearer';
import { auth as oidcAuth } from 'express-openid-connect';
import QRCode from 'qrcode';
import { pool } from './db.js';
import 'dotenv/config';

const app = express();
const port = Number(process.env.PORT ?? 4080);

const getRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const auth0Domain = getRequiredEnv('AUTH0_DOMAIN');
const baseURL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;

const oidcConfig = {
  authRequired: false,
  auth0Logout: true,
  secret: getRequiredEnv('SECRET'),
  baseURL,
  clientID: getRequiredEnv('AUTH0_CLIENT_ID'),
  issuerBaseURL: `https://${auth0Domain}`,
  clientSecret: getRequiredEnv('AUTH0_CLIENT_SECRET'),
  authorizationParams: {
    response_type: 'code',
  },
};

const jwtConfig = {
  audience: getRequiredEnv('AUTH0_AUDIENCE'),
  issuerBaseURL: `https://${auth0Domain}`,
  secret: '',
  tokenSigningAlg: 'RS256' as const,
};

const readPasses = jwtAuth({
  ...jwtConfig,
});

const createPasses = jwtAuth({
  ...jwtConfig,
});

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );

const getPass = async (id: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return undefined;
  }
  const result = await pool.query(
    `SELECT id, name, document, issuedat AS "issuedAt", status
     FROM passes
     WHERE id = $1`,
    [id],
  );
  return result.rows[0];
};

const requireLogin = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void => {
  if (!req.oidc.isAuthenticated()) {
    res.redirect('/login');
    return;
  }
  next();
};

app.use(express.json());
app.use(oidcAuth(oidcConfig));

app.get('/', async (req, res) => {
  try {
    const countResult = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active
      FROM passes
    `);
    const passesResult = req.oidc.isAuthenticated()
      ? await pool.query(
          `SELECT id, name, document, issuedat AS "issuedAt", status
           FROM passes
           ORDER BY issuedat DESC`,
        )
      : { rows: [] };
    const { total, active } = countResult.rows[0];

    let html = `<!doctype html>
      <html lang="hr">
      <head><meta charset="utf-8"><title>Sustav propusnica</title></head>
      <body>
        <h1>Sustav propusnica</h1>
        <p>Ukupno propusnica: ${total}</p>
        <p>Aktivnih propusnica: ${active}</p>`;

    if (!req.oidc.isAuthenticated()) {
      html += '<p><a href="/login">Prijavi se</a></p>';
    } else {
      html += '<p>Prijavljeni ste. <a href="/logout">Odjavi se</a></p>';
      html += `<h2>Propusnice</h2>
        <table border="1">
        <thead><tr><th>Ime</th><th>Dokument</th><th>Status</th><th>Vrijeme izdavanja</th><th>Akcije</th></tr></thead>
        <tbody>`;
      for (const pass of passesResult.rows) {
        const id = escapeHtml(String(pass.id));
        html += `<tr>
          <td>${escapeHtml(String(pass.name))}</td>
          <td>${escapeHtml(String(pass.document))}</td>
          <td>${escapeHtml(String(pass.status))}</td>
          <td>${escapeHtml(new Date(pass.issuedAt).toISOString())}</td>
          <td>
            <a href="/info/${id}">Javna stranica</a>
            ${
              pass.status === 'ACTIVE'
                ? `<form method="post" action="/passes/${id}/cancel" style="display:inline">
                    <button type="submit">Poništi</button>
                   </form>`
                : ''
            }
            <form method="post" action="/passes/${id}/delete" style="display:inline">
              <button type="submit">Obriši</button>
            </form>
          </td>
        </tr>`;
      }
      html += '</tbody></table>';
    }

    res.send(`${html}</body></html>`);
  } catch (error) {
    console.error('Greška pri dohvatu početne stranice:', error);
    res.status(500).send('Greška na poslužitelju');
  }
});

app.get('/info/:id', async (req, res) => {
  try {
    const pass = await getPass(req.params.id);
    if (!pass) {
      res.status(404).send('Propusnica nije pronađena');
      return;
    }
    res.send(`<!doctype html>
      <html lang="hr">
      <head><meta charset="utf-8"><title>Propusnica</title></head>
      <body>
        <h1>Propusnica</h1>
        <p>Status: ${escapeHtml(String(pass.status))}</p>
        <p>Ime i prezime: ${escapeHtml(String(pass.name))}</p>
        <p>Dokument: ${escapeHtml(String(pass.document))}</p>
        <p>Vrijeme izdavanja: ${escapeHtml(new Date(pass.issuedAt).toISOString())}</p>
      </body>
      </html>`);
  } catch (error) {
    console.error('Greška pri dohvatu javne stranice:', error);
    res.status(500).send('Greška na poslužitelju');
  }
});

app.get('/passes/:id', readPasses, requiredScopes('read:passes'), async (req, res) => {
  try {
    const pass = await getPass(String(req.params.id));
    if (!pass) {
      res.status(404).json({ error: 'Pass not found' });
      return;
    }
    res.json({
      id: pass.id,
      name: pass.name,
      document: pass.document,
      issuedAt: new Date(pass.issuedAt).toISOString(),
      status: pass.status,
    });
  } catch (error) {
    console.error('Greška pri API dohvatu propusnice:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/passes', createPasses, requiredScopes('create:passes'), async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const document = typeof req.body?.document === 'string' ? req.body.document.trim() : '';
  if (!name || !document) {
    res.status(400).json({ error: 'name and document are required' });
    return;
  }

  const id = randomUUID();
  const issuedAt = new Date();
  try {
    await pool.query(
      `INSERT INTO passes (id, name, document, issuedat, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE')`,
      [id, name, document, issuedAt],
    );
    const apiURL = new URL(`/passes/${id}`, baseURL).toString();
    const publicURL = new URL(`/info/${id}`, baseURL).toString();
    const qrCode = await QRCode.toBuffer(publicURL, { type: 'png' });
    res.status(201).location(apiURL).type('png').send(qrCode);
  } catch (error) {
    console.error('Greška pri kreiranju propusnice:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/passes/:id/cancel', requireLogin, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE passes
       SET status = 'CANCELLED'
       WHERE id = $1 AND status = 'ACTIVE'
       RETURNING id`,
      [req.params.id],
    );
    if (result.rowCount === 0) {
      res.status(404).send('Aktivna propusnica nije pronađena');
      return;
    }
    res.redirect('/');
  } catch (error) {
    console.error('Greška pri poništavanju propusnice:', error);
    res.status(500).send('Greška na poslužitelju');
  }
});

app.post('/passes/:id/delete', requireLogin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM passes WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).send('Propusnica nije pronađena');
      return;
    }
    res.redirect('/');
  } catch (error) {
    console.error('Greška pri brisanju propusnice:', error);
    res.status(500).send('Greška na poslužitelju');
  }
});

app.delete('/passes/:id', requireLogin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM passes WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Pass not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    console.error('Greška pri brisanju propusnice:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

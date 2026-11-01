import { pool } from './db.js';

async function init() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS passes (
        id UUID PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        document VARCHAR(50) NOT NULL,
        issuedAt TIMESTAMPTZ NOT NULL,
        status VARCHAR(20) NOT NULL
      );
    `);

    const insertQuery = `INSERT INTO passes (id, name, document, issuedat, status)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO NOTHING`;
    const data = ['f81d4fae-7dec-11d0-a765-00a0c91e6bf6', 'Pero Peric', 'HR-123456789', new Date(), 'ACTIVE'];
    
    await pool.query(insertQuery, data);
    console.log('Baza je uspješno inicijalizirana!');
  } catch (err) {
    console.error('Greška pri inicijalizaciji:', err);
  } finally {
    process.exit(0);
  }
}
init();
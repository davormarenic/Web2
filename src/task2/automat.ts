import { writeFile } from 'node:fs/promises';

export async function getToken(
  authority: string,
  audience: string,
  clientId: string,
  clientSecret: string,
  scope: string,
): Promise<string> {
  const tokenUrl = `${authority.replace(/\/$/, '')}/oauth/token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      audience,
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token request failed with status ${response.status}`);
  }

  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    !('access_token' in body) ||
    typeof body.access_token !== 'string'
  ) {
    throw new Error(`Token response failed with status ${response.status}`);
  }

  return body.access_token;
}

export async function issuePass(
  url: string,
  token: string,
  name: string,
  document: string,
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, document }),
  });

  if (!response.ok) {
    throw new Error(`Pass request failed with status ${response.status}`);
  }

  const location = response.headers.get('Location');
  if (!location) {
    throw new Error(`Pass response failed with status ${response.status}`);
  }

  const identifier = new URL(location).pathname.split('/').filter(Boolean).pop();
  if (!identifier) {
    throw new Error(`Pass response failed with status ${response.status}`);
  }

  const image = Buffer.from(await response.arrayBuffer());
  await writeFile(`${identifier}.png`, image);
}
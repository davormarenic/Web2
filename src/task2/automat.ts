import { writeFile } from 'node:fs/promises';

  type TokenResponse = {
    access_token: string;
  };

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
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
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

  const body = (await response.json()) as TokenResponse;
  if (!body.access_token) {
    throw new Error('Token response is missing access_token');
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

  const identifier = location.split('/').filter(Boolean).pop();
  if (!identifier) {
    throw new Error(`Pass response failed with status ${response.status}`);
  }

  const image = Buffer.from(await response.arrayBuffer());
  await writeFile(`${identifier}.png`, image);
}
